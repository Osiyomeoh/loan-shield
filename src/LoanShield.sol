// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMorpho, IIrm, IOracle, IERC20, MarketParams, Market} from "./interfaces/IMorpho.sol";
import {HealthLib} from "./libraries/HealthLib.sol";

/// @title LoanShield
/// @notice Standby USDC that repays just enough of your own Morpho Blue loan, only while it is in danger.
/// @dev No owner, no pause, no upgrade. USDC in `buffer[owner]` leaves in exactly two ways:
///  - `withdraw`, called by that owner, to that owner;
///  - `rescue`, callable by anyone, which repays that owner's own debt in a market they chose, only while
///    the loan's health factor is below their trigger, and only enough to bring it back to their target.
/// Health is measured with Morpho's own formula, oracle and rounding, after accruing interest, so a
/// health factor below 1e18 here is exactly a position `Morpho.liquidate` accepts.
contract LoanShield {
    using HealthLib for uint256;

    struct Policy {
        uint128 trigger; // WAD health factor below which a rescue may run; 0 means no policy
        uint128 target; // WAD health factor a rescue restores
    }

    enum Status {
        Ready,
        NoPolicy,
        NoDebt,
        NotInDanger,
        EmptyBuffer
    }

    /// @notice What `rescue(borrower, id)` would do if called now.
    struct Preview {
        Status status;
        uint256 healthFactor;
        uint256 trigger;
        uint256 target;
        uint256 repayAssets;
        uint256 repayShares;
        uint256 healthFactorAfter;
    }

    /// @notice Highest target a policy may set (WAD).
    uint256 public constant MAX_TARGET = 10e18;

    IMorpho public immutable MORPHO;
    IERC20 public immutable USDC;

    mapping(address owner => uint256 amount) public buffer;
    mapping(address owner => mapping(bytes32 id => Policy)) public policy;

    bool private transient locked;

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event PolicySet(address indexed owner, bytes32 indexed id, uint256 trigger, uint256 target);
    event PolicyCleared(address indexed owner, bytes32 indexed id);
    event Rescued(
        address indexed borrower,
        bytes32 indexed id,
        address indexed caller,
        uint256 assets,
        uint256 shares,
        uint256 healthFactorBefore,
        uint256 healthFactorAfter
    );

    error ZeroAmount();
    error InsufficientBuffer(uint256 available, uint256 requested);
    error InvalidPolicy(uint256 trigger, uint256 target);
    error UnsupportedMarket(bytes32 id);
    error NoPolicy();
    error NoDebt();
    error NotInDanger(uint256 healthFactor, uint256 trigger);
    error EmptyBuffer();
    error UnexpectedRepay(uint256 assets, uint256 shares);
    error NoImprovement(uint256 healthFactorBefore, uint256 healthFactorAfter);
    error TransferFailed();
    error Reentrancy();
    error Uint128Overflow();

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    constructor(IMorpho morpho, IERC20 usdc) {
        MORPHO = morpho;
        USDC = usdc;
    }

    /// @notice Park `amount` USDC in your own buffer. Approve this contract first.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        buffer[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Take `amount` USDC back out of your own buffer. Always available.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = buffer[msg.sender];
        if (amount > available) revert InsufficientBuffer(available, amount);
        buffer[msg.sender] = available - amount;
        emit Withdrawn(msg.sender, amount);
        if (!USDC.transfer(msg.sender, amount)) revert TransferFailed();
    }

    /// @notice Protect your loan in Morpho market `id`: rescue when health drops below `trigger`, back up to `target`.
    /// @param trigger WAD health factor, above 1e18 so the rescue runs before liquidation is possible.
    /// @param target WAD health factor above `trigger` and at most `MAX_TARGET`.
    function setPolicy(bytes32 id, uint256 trigger, uint256 target) external {
        if (trigger <= HealthLib.WAD || target <= trigger || target > MAX_TARGET) {
            revert InvalidPolicy(trigger, target);
        }
        if (MORPHO.idToMarketParams(id).loanToken != address(USDC)) revert UnsupportedMarket(id);
        // casting to 'uint128' is safe because trigger < target <= MAX_TARGET (10e18)
        // forge-lint: disable-next-line(unsafe-typecast)
        policy[msg.sender][id] = Policy(uint128(trigger), uint128(target));
        emit PolicySet(msg.sender, id, trigger, target);
    }

    function clearPolicy(bytes32 id) external {
        delete policy[msg.sender][id];
        emit PolicyCleared(msg.sender, id);
    }

    /// @notice Health factor of `borrower` in market `id` (WAD), including interest owed since the market's last update.
    function healthFactor(address borrower, bytes32 id) external view returns (uint256) {
        MarketParams memory params = MORPHO.idToMarketParams(id);
        Market memory m = _expectedMarket(params, id);
        (, uint128 borrowShares, uint128 collateral) = MORPHO.position(id, borrower);
        if (borrowShares == 0) return type(uint256).max;
        uint256 maxBorrow = HealthLib.maxBorrow(collateral, IOracle(params.oracle).price(), params.lltv);
        return maxBorrow.healthFactor(uint256(borrowShares).toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares));
    }

    /// @notice Exactly what `rescue(borrower, id)` would do in this block.
    function preview(address borrower, bytes32 id) external view returns (Preview memory) {
        MarketParams memory params = MORPHO.idToMarketParams(id);
        return _plan(params, id, borrower, _expectedMarket(params, id));
    }

    /// @notice Repay just enough of `borrower`'s debt in market `id`, from `borrower`'s own buffer, to bring the
    /// loan back to their target. Anyone may call it; it reverts unless the loan is below the borrower's trigger.
    function rescue(address borrower, bytes32 id)
        external
        nonReentrant
        returns (uint256 assets, uint256 healthFactorAfter)
    {
        if (policy[borrower][id].trigger == 0) revert NoPolicy();
        MarketParams memory params = MORPHO.idToMarketParams(id);

        // Plan on fully accrued state, so the numbers are the ones Morpho's repay will use in this block.
        MORPHO.accrueInterest(params);
        Preview memory p = _plan(params, id, borrower, _market(id));
        if (p.status != Status.Ready) _revertFor(p);

        buffer[borrower] -= p.repayAssets;
        if (!USDC.approve(address(MORPHO), p.repayAssets)) revert TransferFailed();
        (uint256 repaidAssets, uint256 repaidShares) = MORPHO.repay(params, 0, p.repayShares, borrower, "");
        if (repaidAssets != p.repayAssets || repaidShares != p.repayShares) {
            revert UnexpectedRepay(repaidAssets, repaidShares);
        }

        (, uint128 borrowShares, uint128 collateral) = MORPHO.position(id, borrower);
        Market memory m = _market(id);
        uint256 maxBorrow = HealthLib.maxBorrow(collateral, IOracle(params.oracle).price(), params.lltv);
        healthFactorAfter =
            maxBorrow.healthFactor(uint256(borrowShares).toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares));
        if (healthFactorAfter <= p.healthFactor) revert NoImprovement(p.healthFactor, healthFactorAfter);

        emit Rescued(borrower, id, msg.sender, repaidAssets, repaidShares, p.healthFactor, healthFactorAfter);
        return (repaidAssets, healthFactorAfter);
    }

    function _plan(MarketParams memory params, bytes32 id, address borrower, Market memory m)
        internal
        view
        returns (Preview memory p)
    {
        Policy memory pol = policy[borrower][id];
        p.trigger = pol.trigger;
        p.target = pol.target;

        (, uint128 borrowShares, uint128 collateral) = MORPHO.position(id, borrower);
        if (borrowShares == 0) {
            p.healthFactor = type(uint256).max;
            p.status = pol.trigger == 0 ? Status.NoPolicy : Status.NoDebt;
            return p;
        }

        uint256 maxBorrow = HealthLib.maxBorrow(collateral, IOracle(params.oracle).price(), params.lltv);
        p.healthFactor =
            maxBorrow.healthFactor(uint256(borrowShares).toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares));

        if (pol.trigger == 0) {
            p.status = Status.NoPolicy;
            return p;
        }

        uint256 shares =
            HealthLib.sharesToTarget(borrowShares, maxBorrow, pol.target, m.totalBorrowAssets, m.totalBorrowShares);
        if (p.healthFactor >= pol.trigger || shares == 0) {
            p.status = Status.NotInDanger;
            return p;
        }

        uint256 affordable = buffer[borrower].toSharesDown(m.totalBorrowAssets, m.totalBorrowShares);
        if (shares > affordable) shares = affordable;
        if (shares == 0) {
            p.status = Status.EmptyBuffer;
            return p;
        }

        p.status = Status.Ready;
        p.repayShares = shares;
        // Rounds up like Morpho's repay-by-shares; never more than the buffer, since `affordable` rounded down.
        p.repayAssets = shares.toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares);

        // State after Morpho's repay: totals drop by the repaid amounts (assets floored at zero, as Morpho does).
        uint256 totalAssetsAfter = m.totalBorrowAssets > p.repayAssets ? m.totalBorrowAssets - p.repayAssets : 0;
        uint256 debtAfter = (borrowShares - shares).toAssetsUp(totalAssetsAfter, m.totalBorrowShares - shares);
        p.healthFactorAfter = maxBorrow.healthFactor(debtAfter);
    }

    /// @dev Market state with interest accrued to this block, as `Morpho.accrueInterest` would leave it.
    /// Fees mint supply shares only, so borrow totals don't depend on them.
    function _expectedMarket(MarketParams memory params, bytes32 id) internal view returns (Market memory m) {
        m = _market(id);
        uint256 elapsed = block.timestamp - m.lastUpdate;
        if (elapsed != 0 && m.totalBorrowAssets != 0 && params.irm != address(0)) {
            uint256 rate = IIrm(params.irm).borrowRateView(params, m);
            uint256 interest = uint256(m.totalBorrowAssets).wMulDown(rate.wTaylorCompounded(elapsed));
            // Same overflow behaviour as Morpho, whose accrual reverts past uint128.
            m.totalBorrowAssets = _toUint128(m.totalBorrowAssets + interest);
            m.totalSupplyAssets = _toUint128(m.totalSupplyAssets + interest);
            m.lastUpdate = _toUint128(block.timestamp);
        }
    }

    function _market(bytes32 id) internal view returns (Market memory m) {
        (m.totalSupplyAssets, m.totalSupplyShares, m.totalBorrowAssets, m.totalBorrowShares, m.lastUpdate, m.fee) =
            MORPHO.market(id);
    }

    function _toUint128(uint256 x) internal pure returns (uint128) {
        if (x > type(uint128).max) revert Uint128Overflow();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(x);
    }

    function _revertFor(Preview memory p) internal pure {
        if (p.status == Status.NoPolicy) revert NoPolicy();
        if (p.status == Status.NoDebt) revert NoDebt();
        if (p.status == Status.NotInDanger) revert NotInDanger(p.healthFactor, p.trigger);
        revert EmptyBuffer();
    }
}
