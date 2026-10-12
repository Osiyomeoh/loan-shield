// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMorpho, IOracle, IERC20, MarketParams} from "../../src/interfaces/IMorpho.sol";

/// Price feed the tests control, for markets the tests create on the real Morpho core.
contract MockOracle is IOracle {
    uint256 public price;

    function setPrice(uint256 newPrice) external {
        price = newPrice;
    }
}

/// Forks Arc mainnet at a pinned block. Run with Arc Foundry (`network = "arc"` in foundry.toml), which
/// provides Arc's native-USDC precompile; stock Foundry reverts on USDC transfers.
abstract contract ArcFork is Test {
    uint256 internal constant FORK_BLOCK = 25_626_000;

    // Addresses verified on Arc mainnet (chain 5042); see README "Addresses".
    IMorpho internal constant MORPHO = IMorpho(0x34CD04070dD72b14E241112F6d83812Df5Af7fCD);
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    IERC20 internal constant CIRBTC = IERC20(0x171A4217b86A807A64eB94757Db6849fb4bDbAA0);
    address internal constant ADAPTIVE_CURVE_IRM = 0xF02615d094Fc02fC031C35fe705e175aA4653f20;
    uint256 internal constant LLTV = 0.86e18;

    bytes32 internal constant CIRBTC_MARKET = 0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d;
    address internal constant CIRBTC_MARKET_ORACLE = 0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab;

    function setUp() public virtual {
        vm.createSelectFork("arc", FORK_BLOCK);
    }

    /// Oracle price for `usd` dollars per cirBTC: 1e36 scale, adjusted for 6-dp USDC and 8-dp cirBTC.
    function _btcPrice(uint256 usd) internal pure returns (uint256) {
        return usd * 1e34;
    }

    /// Arc's USDC ERC-20 reads the native balance (18 dp) at 6 dp, so funding goes through `vm.deal`.
    /// Arc's native-coin precompile reverts "Cannot clear balance of empty account" when a transfer would
    /// zero the balance of an account with nonce 0 and no code (observed under Arc Foundry), so funded test
    /// wallets get nonce 1, like any real wallet that has sent a transaction.
    function _giveUsdc(address to, uint256 amount) internal {
        vm.deal(to, to.balance + amount * 1e12);
        if (to.code.length == 0 && vm.getNonce(to) == 0) vm.setNonce(to, 1);
    }

    function _id(MarketParams memory params) internal pure returns (bytes32) {
        return keccak256(abi.encode(params));
    }

    /// Opens a Morpho position for `borrower` the way Borrow Kit does: collateral and debt on the wallet itself.
    function _openLoan(MarketParams memory params, address borrower, uint256 collateral, uint256 borrowAmount)
        internal
    {
        deal(address(CIRBTC), borrower, collateral);
        vm.startPrank(borrower);
        CIRBTC.approve(address(MORPHO), collateral);
        MORPHO.supplyCollateral(params, collateral, borrower, "");
        MORPHO.borrow(params, borrowAmount, 0, borrower, borrower);
        vm.stopPrank();
    }
}
