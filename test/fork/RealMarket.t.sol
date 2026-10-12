// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcFork} from "./ArcFork.sol";
import {LoanShield} from "../../src/LoanShield.sol";
import {HealthLib} from "../../src/libraries/HealthLib.sol";
import {IOracle, MarketParams} from "../../src/interfaces/IMorpho.sol";

/// The live USDC/cirBTC market that Borrow Kit lends from, with its real liquidity, interest and oracle.
/// Only the oracle's answer is overridden, to simulate a 12% overnight drop in bitcoin.
contract RealMarketTest is ArcFork {
    using HealthLib for uint256;

    LoanShield internal shield;
    MarketParams internal params;
    uint256 internal basePrice;

    address internal tunde = makeAddr("tunde");
    address internal liquidator = makeAddr("liquidator");

    uint256 internal constant COLLATERAL = 0.2e8; // 0.2 cirBTC
    uint256 internal constant TRIGGER = 1.1e18;
    uint256 internal constant TARGET = 1.3e18;
    uint256 internal constant BUFFER = 5_000e6;

    function setUp() public override {
        super.setUp();
        shield = new LoanShield(MORPHO, USDC);
        params = MORPHO.idToMarketParams(CIRBTC_MARKET);
        assertEq(params.loanToken, address(USDC));
        assertEq(params.collateralToken, address(CIRBTC));
        assertEq(params.oracle, CIRBTC_MARKET_ORACLE);
        assertEq(params.lltv, LLTV);
        basePrice = IOracle(CIRBTC_MARKET_ORACLE).price();

        // Borrow to a health factor of about 1.12, a typical "a bit aggressive" loan.
        uint256 maxBorrow = HealthLib.maxBorrow(COLLATERAL, basePrice, params.lltv);
        _openLoan(params, tunde, COLLATERAL, (maxBorrow * 1e18) / 1.12e18);

        _giveUsdc(tunde, BUFFER);
        vm.startPrank(tunde);
        USDC.approve(address(shield), BUFFER);
        shield.deposit(BUFFER);
        shield.setPolicy(CIRBTC_MARKET, TRIGGER, TARGET);
        vm.stopPrank();

        _giveUsdc(liquidator, 20_000e6);
        vm.prank(liquidator);
        USDC.approve(address(MORPHO), type(uint256).max);
    }

    function _dropBtc(uint256 percent) internal returns (uint256 price) {
        price = (basePrice * (100 - percent)) / 100;
        vm.mockCall(CIRBTC_MARKET_ORACLE, abi.encodeWithSelector(IOracle.price.selector), abi.encode(price));
    }

    function _borrowShares() internal view returns (uint256 shares) {
        (, shares,) = MORPHO.position(CIRBTC_MARKET, tunde);
    }

    function test_noRescueAtTodaysPrice() public {
        uint256 hf = shield.healthFactor(tunde, CIRBTC_MARKET);
        assertGt(hf, TRIGGER);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.NotInDanger.selector, hf, TRIGGER));
        shield.rescue(tunde, CIRBTC_MARKET);
    }

    /// Without the shield: a 12% drop makes the loan liquidatable, and the liquidator takes a 4.38% bonus
    /// in collateral on everything repaid.
    function test_withoutShield_dropGetsLiquidated() public {
        uint256 price = _dropBtc(12);
        assertLt(shield.healthFactor(tunde, CIRBTC_MARKET), 1e18);

        uint256 repayShares = _borrowShares() / 2;
        vm.prank(liquidator);
        (uint256 seized, uint256 repaid) = MORPHO.liquidate(params, tunde, 0, repayShares, "");

        uint256 lif = HealthLib.liquidationIncentive(params.lltv);
        assertEq(lif, 1_043_841_336_116_910_229);
        assertEq(seized, repaid.wMulDown(lif).mulDivDown(1e36, price), "Morpho's seize formula");
        // Collateral seized is worth 4.38% more than the debt repaid.
        uint256 seizedValue = seized.mulDivDown(price, 1e36);
        assertApproxEqRel(seizedValue, repaid + (repaid * 43_841_336) / 1_000e6, 0.0001e18);
    }

    /// With the shield: the same drop, a keeper calls rescue first, and the liquidation is refused.
    function test_withShield_rescueBlocksLiquidation() public {
        _dropBtc(12);
        uint256 hfBefore = shield.healthFactor(tunde, CIRBTC_MARKET);
        assertLt(hfBefore, 1e18);

        LoanShield.Preview memory p = shield.preview(tunde, CIRBTC_MARKET);
        assertEq(uint256(p.status), uint256(LoanShield.Status.Ready));
        assertLt(p.repayAssets, BUFFER, "buffer covers the full rescue");

        vm.prank(makeAddr("keeper"));
        (uint256 assets, uint256 hfAfter) = shield.rescue(tunde, CIRBTC_MARKET);
        assertEq(assets, p.repayAssets);
        assertGe(hfAfter, TARGET);
        assertEq(shield.buffer(tunde), BUFFER - assets);

        uint256 shares = _borrowShares();
        vm.prank(liquidator);
        vm.expectRevert(bytes("position is healthy"));
        MORPHO.liquidate(params, tunde, 0, shares / 2, "");
    }

    /// Interest keeps accruing on the real market; a rescue a week later still lands exactly on target.
    function test_withShield_afterAWeekOfInterest() public {
        skip(7 days);
        _dropBtc(12);
        LoanShield.Preview memory p = shield.preview(tunde, CIRBTC_MARKET);
        (uint256 assets, uint256 hfAfter) = shield.rescue(tunde, CIRBTC_MARKET);
        assertEq(assets, p.repayAssets);
        assertEq(hfAfter, p.healthFactorAfter);
        assertGe(hfAfter, TARGET);
    }
}
