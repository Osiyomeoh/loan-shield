// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcFork, MockOracle} from "./ArcFork.sol";
import {LoanShield} from "../../src/LoanShield.sol";
import {MarketParams} from "../../src/interfaces/IMorpho.sol";

/// Loan Shield against the real Morpho Blue core, USDC, cirBTC and IRM on Arc mainnet, in a fresh
/// USDC/cirBTC market (LLTV 0.86) whose oracle the test controls.
contract LoanShieldTest is ArcFork {
    LoanShield internal shield;
    MockOracle internal oracle;
    MarketParams internal params;
    bytes32 internal id;

    address internal lender = makeAddr("lender");
    address internal tunde = makeAddr("tunde");
    address internal ada = makeAddr("ada");
    address internal keeper = makeAddr("keeper");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant TRIGGER = 1.2e18;
    uint256 internal constant TARGET = 1.4e18;

    function setUp() public override {
        super.setUp();
        shield = new LoanShield(MORPHO, USDC);

        oracle = new MockOracle();
        oracle.setPrice(_btcPrice(80_000));
        params = MarketParams(address(USDC), address(CIRBTC), address(oracle), ADAPTIVE_CURVE_IRM, LLTV);
        MORPHO.createMarket(params);
        id = _id(params);

        _giveUsdc(lender, 1_000_000e6);
        vm.startPrank(lender);
        USDC.approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(params, 1_000_000e6, 0, lender, "");
        vm.stopPrank();

        // 1 cirBTC at $80,000 supports 68,800 USDC; 50,000 borrowed gives health 1.376.
        _openLoan(params, tunde, 1e8, 50_000e6);
        _shield(tunde, 10_000e6, TRIGGER, TARGET);
    }

    function _shield(address owner, uint256 amount, uint256 trigger, uint256 target) internal {
        _giveUsdc(owner, amount);
        vm.startPrank(owner);
        USDC.approve(address(shield), amount);
        shield.deposit(amount);
        shield.setPolicy(id, trigger, target);
        vm.stopPrank();
    }

    function _borrowShares(address user) internal view returns (uint256 shares) {
        (, shares,) = MORPHO.position(id, user);
    }

    // ---------------------------------------------------------------- buffer

    function test_deposit_creditsOwnBuffer() public view {
        assertEq(shield.buffer(tunde), 10_000e6);
        assertEq(USDC.balanceOf(address(shield)), 10_000e6);
    }

    function test_withdraw_returnsToOwner() public {
        uint256 before = USDC.balanceOf(tunde);
        vm.expectEmit(address(shield));
        emit LoanShield.Withdrawn(tunde, 4_000e6);
        vm.prank(tunde);
        shield.withdraw(4_000e6);
        assertEq(USDC.balanceOf(tunde), before + 4_000e6);
        assertEq(shield.buffer(tunde), 6_000e6);
    }

    function test_withdraw_onlyOwnBuffer() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.InsufficientBuffer.selector, 0, 1));
        shield.withdraw(1);

        vm.prank(tunde);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.InsufficientBuffer.selector, 10_000e6, 10_000e6 + 1));
        shield.withdraw(10_000e6 + 1);
    }

    function test_withdraw_stillWorksWhileInDanger() public {
        oracle.setPrice(_btcPrice(68_000));
        vm.prank(tunde);
        shield.withdraw(10_000e6);
        assertEq(shield.buffer(tunde), 0);
    }

    function test_zeroAmountsRevert() public {
        vm.startPrank(tunde);
        vm.expectRevert(LoanShield.ZeroAmount.selector);
        shield.deposit(0);
        vm.expectRevert(LoanShield.ZeroAmount.selector);
        shield.withdraw(0);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- policy

    function test_setPolicy_rejectsBadBounds() public {
        vm.startPrank(tunde);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.InvalidPolicy.selector, 1e18, 1.3e18));
        shield.setPolicy(id, 1e18, 1.3e18); // trigger must be above liquidation (1.0)
        vm.expectRevert(abi.encodeWithSelector(LoanShield.InvalidPolicy.selector, 1.2e18, 1.2e18));
        shield.setPolicy(id, 1.2e18, 1.2e18); // target must be above trigger
        vm.expectRevert(abi.encodeWithSelector(LoanShield.InvalidPolicy.selector, 1.2e18, 10e18 + 1));
        shield.setPolicy(id, 1.2e18, 10e18 + 1);
        vm.stopPrank();
    }

    function test_setPolicy_rejectsMarketsThatDontLendUsdc() public {
        MarketParams memory inverted =
            MarketParams(address(CIRBTC), address(USDC), address(oracle), ADAPTIVE_CURVE_IRM, LLTV);
        MORPHO.createMarket(inverted);
        bytes32 invertedId = _id(inverted);

        vm.startPrank(tunde);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.UnsupportedMarket.selector, invertedId));
        shield.setPolicy(invertedId, TRIGGER, TARGET);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.UnsupportedMarket.selector, bytes32(uint256(1))));
        shield.setPolicy(bytes32(uint256(1)), TRIGGER, TARGET); // no such market
        vm.stopPrank();
    }

    function test_setPolicy_storesAndEmits() public {
        vm.expectEmit(address(shield));
        emit LoanShield.PolicySet(tunde, id, 1.1e18, 1.5e18);
        vm.prank(tunde);
        shield.setPolicy(id, 1.1e18, 1.5e18);
        (uint128 trigger, uint128 target) = shield.policy(tunde, id);
        assertEq(trigger, 1.1e18);
        assertEq(target, 1.5e18);
    }

    function test_clearPolicy_disablesRescue() public {
        vm.prank(tunde);
        shield.clearPolicy(id);
        oracle.setPrice(_btcPrice(68_000));
        vm.expectRevert(LoanShield.NoPolicy.selector);
        shield.rescue(tunde, id);
    }

    // ---------------------------------------------------------------- rescue: refusals

    function test_rescue_revertsWhenHealthy() public {
        uint256 hf = shield.healthFactor(tunde, id);
        assertEq(hf, 1.376e18);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.NotInDanger.selector, hf, TRIGGER));
        shield.rescue(tunde, id);
    }

    function test_rescue_revertsWithoutPolicy() public {
        vm.expectRevert(LoanShield.NoPolicy.selector);
        shield.rescue(stranger, id);
    }

    function test_rescue_revertsWithoutDebt() public {
        _shield(stranger, 100e6, TRIGGER, TARGET);
        vm.expectRevert(LoanShield.NoDebt.selector);
        shield.rescue(stranger, id);
    }

    function test_rescue_revertsWhenBufferEmpty() public {
        vm.prank(tunde);
        shield.withdraw(10_000e6);
        oracle.setPrice(_btcPrice(68_000));
        vm.expectRevert(LoanShield.EmptyBuffer.selector);
        shield.rescue(tunde, id);
    }

    // ---------------------------------------------------------------- rescue: the airbag

    function test_rescue_restoresTargetAfterPriceDrop() public {
        oracle.setPrice(_btcPrice(68_000)); // health 1.1696, below the 1.2 trigger
        uint256 hfBefore = shield.healthFactor(tunde, id);
        assertLt(hfBefore, TRIGGER);

        LoanShield.Preview memory p = shield.preview(tunde, id);
        assertEq(uint256(p.status), uint256(LoanShield.Status.Ready));
        uint256 sharesBefore = _borrowShares(tunde);
        uint256 keeperUsdc = USDC.balanceOf(keeper);
        uint256 morphoUsdc = USDC.balanceOf(address(MORPHO));

        vm.expectEmit(address(shield));
        emit LoanShield.Rescued(tunde, id, keeper, p.repayAssets, p.repayShares, hfBefore, p.healthFactorAfter);
        vm.prank(keeper);
        (uint256 assets, uint256 hfAfter) = shield.rescue(tunde, id);

        assertGe(hfAfter, TARGET, "below target");
        assertLt(hfAfter, TARGET + 1e12, "repaid more than needed");
        assertEq(hfAfter, shield.healthFactor(tunde, id));
        // About 8,228.57 USDC: debt down to 58,480 / 1.4.
        assertApproxEqAbs(assets, 8_228_571_429, 2);

        assertEq(shield.buffer(tunde), 10_000e6 - assets);
        assertEq(USDC.balanceOf(address(shield)), 10_000e6 - assets);
        assertEq(USDC.balanceOf(address(MORPHO)), morphoUsdc + assets, "repayment went to Morpho");
        assertEq(USDC.balanceOf(keeper), keeperUsdc, "keeper is not paid from the buffer");
        assertEq(USDC.allowance(address(shield), address(MORPHO)), 0, "no leftover allowance");
        assertEq(_borrowShares(tunde), sharesBefore - p.repayShares);
    }

    function test_rescue_secondCallReverts() public {
        oracle.setPrice(_btcPrice(68_000));
        (, uint256 hfAfter) = shield.rescue(tunde, id);
        vm.expectRevert(abi.encodeWithSelector(LoanShield.NotInDanger.selector, hfAfter, TRIGGER));
        shield.rescue(tunde, id);
    }

    function test_rescue_partialWhenBufferShort() public {
        vm.prank(tunde);
        shield.withdraw(9_000e6); // 1,000 USDC left, about 8,229 needed
        oracle.setPrice(_btcPrice(68_000));
        uint256 hfBefore = shield.healthFactor(tunde, id);

        (uint256 assets, uint256 hfAfter) = shield.rescue(tunde, id);
        assertEq(assets, 1_000e6, "spends the whole buffer");
        assertEq(shield.buffer(tunde), 0);
        assertGt(hfAfter, hfBefore);
        assertLt(hfAfter, TARGET);

        vm.expectRevert(LoanShield.EmptyBuffer.selector);
        shield.rescue(tunde, id);
    }

    function test_rescue_repaysWholeLoanWhenCollateralCollapses() public {
        _giveUsdc(tunde, 45_000e6);
        vm.startPrank(tunde);
        USDC.approve(address(shield), 45_000e6);
        shield.deposit(45_000e6); // buffer 55,000 > debt 50,000
        vm.stopPrank();
        oracle.setPrice(1); // collateral worth ~nothing

        (uint256 assets, uint256 hfAfter) = shield.rescue(tunde, id);
        assertEq(_borrowShares(tunde), 0, "debt fully repaid");
        assertEq(hfAfter, type(uint256).max);
        assertApproxEqAbs(assets, 50_000e6, 1);
        assertEq(shield.buffer(tunde), 55_000e6 - assets);
    }

    function test_rescue_onlyTouchesTheBorrowersOwnBuffer() public {
        _openLoan(params, ada, 1e8, 40_000e6);
        _shield(ada, 5_000e6, TRIGGER, TARGET);
        oracle.setPrice(_btcPrice(68_000)); // tunde in danger; ada at 1.462 is not

        (uint256 assets,) = shield.rescue(tunde, id);
        assertEq(shield.buffer(ada), 5_000e6);
        assertEq(USDC.balanceOf(address(shield)), shield.buffer(tunde) + shield.buffer(ada));
        assertEq(shield.buffer(tunde), 10_000e6 - assets);

        // 58,480 / 40,000 = 1.462: not in danger, so ada's buffer can't be spent.
        vm.expectRevert(abi.encodeWithSelector(LoanShield.NotInDanger.selector, 1.462e18, TRIGGER));
        shield.rescue(ada, id);
    }

    /// A price gap straight past the trigger into liquidation territory: if the rescue lands first, even a
    /// buffer too small to reach the target takes the loan out of liquidation.
    function test_rescue_beatsLiquidationAfterGapDown() public {
        oracle.setPrice(_btcPrice(57_000)); // health 49,020 / 50,000 = 0.9804: Morpho would liquidate
        assertLt(shield.healthFactor(tunde, id), 1e18);

        (uint256 assets, uint256 hfAfter) = shield.rescue(tunde, id);
        assertEq(assets, 10_000e6, "whole buffer, ~14,986 was needed for the target");
        assertEq(hfAfter, 1.2255e18); // 49,020 / 40,000

        address liquidator = makeAddr("liquidator");
        _giveUsdc(liquidator, 10_000e6);
        vm.startPrank(liquidator);
        USDC.approve(address(MORPHO), type(uint256).max);
        vm.expectRevert(bytes("position is healthy"));
        MORPHO.liquidate(params, tunde, 1_000, 0, "");
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- consistency with Morpho

    /// `preview` (which estimates interest with the IRM's view) must match what `rescue` then does after
    /// Morpho really accrues it.
    function testFuzz_previewEqualsRescue(uint256 elapsed, uint256 usd) public {
        elapsed = bound(elapsed, 0, 365 days);
        usd = bound(usd, 40_000, 69_000);
        vm.warp(block.timestamp + elapsed);
        oracle.setPrice(_btcPrice(usd));

        LoanShield.Preview memory p = shield.preview(tunde, id);
        if (p.status != LoanShield.Status.Ready) {
            vm.expectRevert();
            shield.rescue(tunde, id);
            return;
        }
        assertEq(shield.healthFactor(tunde, id), p.healthFactor);
        uint256 sharesBefore = _borrowShares(tunde);

        (uint256 assets, uint256 hfAfter) = shield.rescue(tunde, id);
        assertEq(assets, p.repayAssets);
        assertEq(hfAfter, p.healthFactorAfter);
        assertEq(_borrowShares(tunde), sharesBefore - p.repayShares);
    }

    /// The shield's health factor < 1 exactly when Morpho accepts a liquidation.
    function testFuzz_healthMatchesMorphoLiquidation(uint256 price) public {
        // $57,000..$60,000 brackets the liquidation price (50,000 / 0.86 = $58,139.53).
        price = bound(price, _btcPrice(57_000), _btcPrice(60_000));
        oracle.setPrice(price);
        bool shieldSaysLiquidatable = shield.healthFactor(tunde, id) < 1e18;

        address liquidator = makeAddr("liquidator");
        _giveUsdc(liquidator, 1_000e6);
        vm.startPrank(liquidator);
        USDC.approve(address(MORPHO), type(uint256).max);
        if (shieldSaysLiquidatable) {
            (uint256 seized,) = MORPHO.liquidate(params, tunde, 0, 1e12, ""); // ~1 USDC of debt
            assertGt(seized, 0);
        } else {
            vm.expectRevert(bytes("position is healthy"));
            MORPHO.liquidate(params, tunde, 0, 1e12, "");
        }
        vm.stopPrank();
    }

    function test_healthAtExactLiquidationBoundary() public {
        // Debt 50,000e6; collateral 1e8; maxBorrow = 1e8 * price / 1e36 * 0.86 rounds down.
        // At $58,139.53 maxBorrow = 49,999.99 < 50,000; at $58,139.54 it is 50,000.004 >= 50,000.
        oracle.setPrice(5_813_953 * 1e32);
        assertLt(shield.healthFactor(tunde, id), 1e18);
        oracle.setPrice(5_813_954 * 1e32);
        assertGe(shield.healthFactor(tunde, id), 1e18);
    }
}
