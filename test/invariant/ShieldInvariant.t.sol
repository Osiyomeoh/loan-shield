// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ArcFork, MockOracle} from "../fork/ArcFork.sol";
import {LoanShield} from "../../src/LoanShield.sol";
import {IMorpho, IERC20, MarketParams} from "../../src/interfaces/IMorpho.sol";

/// Drives Loan Shield with random sequences of deposits, withdrawals, price moves, time jumps, extra
/// borrowing, policy changes and rescues by arbitrary callers, and records anything that breaks the rules.
contract Handler is Test {
    LoanShield internal immutable shield;
    IMorpho internal immutable morpho;
    IERC20 internal immutable usdc;
    MockOracle internal immutable oracle;
    MarketParams internal params;
    bytes32 internal immutable id;

    address[2] public actors;

    mapping(address => uint256) public ghostDeposited;
    mapping(address => uint256) public ghostWithdrawn;
    mapping(address => uint256) public ghostRescued;
    uint256 public rescues;
    uint256 public rescueWhileNotReady;
    uint256 public rescueMissedTarget;
    uint256 public rescueNotMatchingPreview;

    constructor(
        LoanShield shield_,
        IMorpho morpho_,
        IERC20 usdc_,
        MockOracle oracle_,
        MarketParams memory params_,
        address[2] memory actors_
    ) {
        shield = shield_;
        morpho = morpho_;
        usdc = usdc_;
        oracle = oracle_;
        params = params_;
        id = keccak256(abi.encode(params_));
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 2];
    }

    function deposit(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        amount = bound(amount, 1, 20_000e6);
        vm.deal(a, a.balance + amount * 1e12);
        vm.startPrank(a);
        usdc.approve(address(shield), amount);
        shield.deposit(amount);
        vm.stopPrank();
        ghostDeposited[a] += amount;
    }

    function withdraw(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        uint256 available = shield.buffer(a);
        if (available == 0) return;
        amount = bound(amount, 1, available);
        vm.prank(a);
        shield.withdraw(amount);
        ghostWithdrawn[a] += amount;
    }

    function setPrice(uint256 usd) external {
        oracle.setPrice(bound(usd, 30_000, 100_000) * 1e34);
    }

    function warp(uint256 secs) external {
        skip(bound(secs, 1, 30 days));
    }

    function borrowMore(uint256 seed, uint256 amount) external {
        address a = _actor(seed);
        vm.prank(a);
        try morpho.borrow(params, bound(amount, 1e6, 20_000e6), 0, a, a) {} catch {}
    }

    function setPolicy(uint256 seed, uint256 trigger, uint256 gap) external {
        trigger = bound(trigger, 1.01e18, 2e18);
        vm.prank(_actor(seed));
        shield.setPolicy(id, trigger, trigger + bound(gap, 0.01e18, 1e18));
    }

    function clearPolicy(uint256 seed) external {
        if (seed % 4 != 0) return; // rarer than setPolicy, so loans stay protected most of the time
        vm.prank(_actor(seed));
        shield.clearPolicy(id);
    }

    function rescue(uint256 seed, uint256 callerSeed) external {
        address a = _actor(seed);
        address caller = address(uint160(uint256(keccak256(abi.encode("keeper", callerSeed)))));
        LoanShield.Preview memory p = shield.preview(a, id);
        uint256 bufferBefore = shield.buffer(a);

        vm.prank(caller);
        try shield.rescue(a, id) returns (uint256 assets, uint256 hfAfter) {
            rescues++;
            ghostRescued[a] += assets;
            if (p.status != LoanShield.Status.Ready || p.healthFactor >= p.trigger) rescueWhileNotReady++;
            if (assets != p.repayAssets || hfAfter != p.healthFactorAfter) rescueNotMatchingPreview++;
            // Below target is only acceptable when the buffer ran out.
            if (
                hfAfter < p.target && assets != bufferBefore
                    && shield.preview(a, id).status != LoanShield.Status.EmptyBuffer
            ) {
                rescueMissedTarget++;
            }
        } catch {
            if (p.status == LoanShield.Status.Ready) rescueNotMatchingPreview++;
        }
    }
}

contract ShieldInvariantTest is ArcFork {
    LoanShield internal shield;
    Handler internal handler;
    address internal tunde = makeAddr("tunde");
    address internal ada = makeAddr("ada");

    function setUp() public override {
        super.setUp();
        shield = new LoanShield(MORPHO, USDC);
        MockOracle oracle = new MockOracle();
        oracle.setPrice(_btcPrice(80_000));
        MarketParams memory params =
            MarketParams(address(USDC), address(CIRBTC), address(oracle), ADAPTIVE_CURVE_IRM, LLTV);
        MORPHO.createMarket(params);
        bytes32 id = _id(params);

        address lender = makeAddr("lender");
        _giveUsdc(lender, 10_000_000e6);
        vm.startPrank(lender);
        USDC.approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(params, 10_000_000e6, 0, lender, "");
        vm.stopPrank();

        _openLoan(params, tunde, 1e8, 50_000e6);
        _openLoan(params, ada, 2e8, 120_000e6);
        address[2] memory actors = [tunde, ada];
        for (uint256 i; i < 2; i++) {
            _giveUsdc(actors[i], 1); // nonce 1, see ArcFork._giveUsdc
            vm.prank(actors[i]);
            shield.setPolicy(id, 1.2e18, 1.4e18);
        }

        handler = new Handler(shield, MORPHO, USDC, oracle, params, actors);
        targetContract(address(handler));
        // Without explicit senders the fuzzer also sends from address literals it finds in the source,
        // such as USDC's 0x3600…0000, and Arc rejects transactions from system addresses ("Blocked address").
        targetSender(makeAddr("sender1"));
        targetSender(makeAddr("sender2"));

        // Start with funded buffers (through the handler, so its ledger sees them). At $80,000 ada's
        // health is 137,600 / 120,000 = 1.147, already below the 1.2 trigger.
        handler.deposit(0, 10_000e6);
        handler.deposit(1, 10_000e6);
    }

    /// Every unit of USDC the shield holds belongs to some owner's buffer.
    function invariant_balanceEqualsBuffers() public view {
        assertEq(USDC.balanceOf(address(shield)), shield.buffer(tunde) + shield.buffer(ada));
    }

    /// A buffer only ever goes down by its owner's withdrawals and rescues of that owner's own loan.
    function invariant_bufferAccounting() public view {
        address[2] memory actors = [tunde, ada];
        for (uint256 i; i < 2; i++) {
            address a = actors[i];
            assertEq(shield.buffer(a), handler.ghostDeposited(a) - handler.ghostWithdrawn(a) - handler.ghostRescued(a));
        }
    }

    function invariant_rescuesFollowTheRules() public view {
        assertEq(handler.rescueWhileNotReady(), 0, "rescued a loan that was not below its trigger");
        assertEq(handler.rescueMissedTarget(), 0, "stopped short of target with buffer left");
        assertEq(handler.rescueNotMatchingPreview(), 0, "preview disagreed with rescue");
    }

    /// Shows the runs did exercise rescues (run with -vv).
    function afterInvariant() public view {
        console2.log("rescues", handler.rescues());
    }

    function invariant_noAllowanceLeftWithMorpho() public view {
        assertEq(USDC.allowance(address(shield), address(MORPHO)), 0);
    }
}
