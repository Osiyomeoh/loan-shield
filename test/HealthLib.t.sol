// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HealthLib} from "../src/libraries/HealthLib.sol";

/// Pure math checks. Expected constants were computed independently with Python integer arithmetic.
contract HealthLibTest is Test {
    uint256 constant WAD = 1e18;

    function test_liquidationIncentive_lltv86() public pure {
        // Morpho: min(1.15, 1 / (1 - 0.3 * (1 - 0.86))) = 1 / 0.958
        assertEq(HealthLib.liquidationIncentive(0.86e18), 1_043_841_336_116_910_229);
    }

    function test_penaltyPer1000Usdc_lltv86() public pure {
        uint256 lif = HealthLib.liquidationIncentive(0.86e18);
        // $43.84 of a $1,000 repayment goes to the liquidator as extra collateral.
        assertEq((1000e6 * (lif - WAD)) / WAD, 43_841_336);
    }

    function test_liquidationIncentive_lltv77() public pure {
        assertEq(HealthLib.liquidationIncentive(0.77e18), 1_074_113_856_068_743_286);
    }

    function test_liquidationIncentive_cappedAt115() public pure {
        assertEq(HealthLib.liquidationIncentive(0), 1.15e18);
    }

    function test_wTaylorCompounded_oneYearAt100Pct() public pure {
        // 1 + 1/2 + 1/6 to three terms, with the rate truncated to a per-second WAD.
        assertEq(HealthLib.wTaylorCompounded(31_709_791_983, 31_536_000), 1_666_666_666_606_386_666);
    }

    function test_maxBorrow_cirBtcMarketUnits() public pure {
        // 1 cirBTC (8 dp) at $80,000 in USDC (6 dp): oracle price = 80,000 * 1e(36 + 6 - 8).
        uint256 price = 80_000 * 1e34;
        assertEq(HealthLib.maxBorrow(1e8, price, 0.86e18), 68_800e6);
    }

    function test_healthFactor_noDebtIsMax() public pure {
        assertEq(HealthLib.healthFactor(123, 0), type(uint256).max);
    }

    /// The shield's "below 1.0" must be exactly Morpho's `maxBorrow < borrowed`.
    function testFuzz_healthFactorBelowOneIffLiquidatable(uint256 maxBorrow, uint256 borrowed) public pure {
        maxBorrow = bound(maxBorrow, 0, 1e30);
        borrowed = bound(borrowed, 1, 1e30);
        assertEq(HealthLib.healthFactor(maxBorrow, borrowed) < WAD, maxBorrow < borrowed);
    }

    /// Model of `Morpho.repay(params, 0, shares, ...)`: assets rounded up, totals reduced, assets floored at 0.
    function _debtAfterRepay(uint256 borrowShares, uint256 shares, uint256 totalAssets, uint256 totalShares)
        internal
        pure
        returns (uint256)
    {
        uint256 assets = HealthLib.toAssetsUp(shares, totalAssets, totalShares);
        uint256 totalAssetsAfter = totalAssets > assets ? totalAssets - assets : 0;
        return HealthLib.toAssetsUp(borrowShares - shares, totalAssetsAfter, totalShares - shares);
    }

    /// Repaying `sharesToTarget` always reaches the target, and leaves at most one share's worth of debt
    /// below what the target allows (it doesn't over-repay).
    function testFuzz_sharesToTarget_reachesTargetWithoutOverRepaying(
        uint256 totalAssets,
        uint256 sharesPerAsset,
        uint256 borrowShares,
        uint256 maxBorrow,
        uint256 target
    ) public pure {
        totalAssets = bound(totalAssets, 1e6, 1e15); // 1 USDC .. 1B USDC borrowed in the market
        sharesPerAsset = bound(sharesPerAsset, 0.5e6, 1e6); // starts at 1e6 and falls as interest accrues
        uint256 totalShares = totalAssets * sharesPerAsset;
        borrowShares = bound(borrowShares, 1e6, totalShares);
        maxBorrow = bound(maxBorrow, 0, 10 * totalAssets);
        target = bound(target, WAD + 1, 10e18);

        uint256 debt = HealthLib.toAssetsUp(borrowShares, totalAssets, totalShares);
        vm.assume(HealthLib.healthFactor(maxBorrow, debt) < target);

        uint256 shares = HealthLib.sharesToTarget(borrowShares, maxBorrow, target, totalAssets, totalShares);
        assertGt(shares, 0);
        assertLe(shares, borrowShares);

        uint256 debtAfter = _debtAfterRepay(borrowShares, shares, totalAssets, totalShares);
        assertGe(HealthLib.healthFactor(maxBorrow, debtAfter), target, "target not reached");

        uint256 allowedDebt = (maxBorrow * WAD) / target;
        assertLe(allowedDebt - debtAfter, HealthLib.toAssetsUp(1, totalAssets, totalShares), "over-repaid");
    }
}
