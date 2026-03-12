import { describe, expect, it } from "vitest";
import { GammaApiClient } from "./gamma-client.js";
import { ClobApiClient } from "./clob-client.js";
import { DataApiClient } from "./data-client.js";

async function findLiveWalletAndMarket(): Promise<{ wallet: string; conditionId: string }> {
  const gamma = new GammaApiClient({ retries: 1, timeout: 10000 });
  const clob = new ClobApiClient({ retries: 1, timeout: 10000 });
  const markets = await gamma.getMarkets({ active: true, closed: false, limit: 20 });

  for (const market of markets) {
    for (const tokenId of market.clobTokenIds ?? []) {
      const { trades } = await clob.getTradesByToken(tokenId, { limit: 25 });
      const trade = trades.find((candidate) => candidate.owner ?? candidate.maker_address);

      if (trade) {
        return {
          wallet: trade.owner ?? trade.maker_address!,
          conditionId: market.conditionId,
        };
      }
    }
  }

  throw new Error("Could not find a live market with a public trader address");
}

describe("Data API integration", () => {
  it("fetches live public wallet enrichment data from Polymarket", async () => {
    const client = new DataApiClient({ retries: 1, timeout: 10000 });
    const liveSeed = await findLiveWalletAndMarket();

    const [activity, positions, closedPositions, holders] = await Promise.all([
      client.getUserActivity({
        user: liveSeed.wallet,
        market: [liveSeed.conditionId],
        limit: 10,
        sortDirection: "DESC",
      }),
      client.getUserPositions({
        user: liveSeed.wallet,
        limit: 10,
      }),
      client.getClosedPositions({
        user: liveSeed.wallet,
        limit: 10,
      }),
      client.getMarketHolders({
        market: [liveSeed.conditionId],
        limit: 10,
      }),
    ]);

    expect(Array.isArray(activity)).toBe(true);
    expect(activity.every((item) => item.timestamp instanceof Date)).toBe(true);
    expect(Array.isArray(positions)).toBe(true);
    expect(positions.every((item) => item.endDate === null || item.endDate instanceof Date)).toBe(true);
    expect(Array.isArray(closedPositions)).toBe(true);
    expect(closedPositions.every((item) => item.timestamp instanceof Date)).toBe(true);
    expect(holders.length).toBeGreaterThan(0);
    expect(holders[0]?.holders.length).toBeGreaterThan(0);
  }, 30000);
});
