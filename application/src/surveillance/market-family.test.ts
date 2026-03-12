import { describe, expect, it } from "vitest";
import { gammaEventSchema, type GammaEvent } from "../api/types.js";
import {
  classifyMarketFamily,
  type MarketFamilyClassification,
} from "./market-family.js";

function parseEvent(raw: unknown): GammaEvent {
  return gammaEventSchema.parse(raw);
}

function expectClassification(event: GammaEvent, expected: MarketFamilyClassification): void {
  const family = classifyMarketFamily(event);
  expect(family.classification).toBe(expected);
}

describe("classifyMarketFamily", () => {
  it("classifies a standalone binary event", () => {
    const event = parseEvent({
      id: "event-1",
      title: "BitBoy convicted?",
      slug: "bitboy-convicted",
      endDate: "2026-03-31T12:00:00Z",
      showAllOutcomes: false,
      markets: [
        {
          id: "market-1",
          question: "BitBoy convicted?",
          conditionId: "cond-1",
          slug: "bitboy-convicted",
          endDate: "2026-03-31T12:00:00Z",
          liquidity: "100000",
          volume: "500000",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0.364\", \"0.636\"]",
          clobTokenIds: "[\"yes-token\", \"no-token\"]",
        },
      ],
    });

    expectClassification(event, "standalone_binary");
  });

  it("classifies grouped by-date families even when event and child end dates are missing", () => {
    const event = parseEvent({
      id: "event-2",
      title: "US x Iran ceasefire by...?",
      slug: "us-x-iran-ceasefire-by",
      endDate: null,
      showAllOutcomes: true,
      markets: [
        {
          id: "market-2",
          question: "US x Iran ceasefire by March 31?",
          conditionId: "cond-2",
          slug: "us-x-iran-ceasefire-by-march-31",
          endDate: null,
          groupItemTitle: "March 31",
          groupItemThreshold: "3",
          liquidity: "297368.8983",
          volume: "6644047.602551099",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0.235\", \"0.765\"]",
          clobTokenIds: "[\"yes-token\", \"no-token\"]",
        },
        {
          id: "market-3",
          question: "US x Iran ceasefire by April 30?",
          conditionId: "cond-3",
          slug: "us-x-iran-ceasefire-by-april-30",
          endDate: null,
          groupItemTitle: "April 30",
          groupItemThreshold: "4",
          liquidity: "184344.5543",
          volume: "2045584.5737730016",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0.465\", \"0.535\"]",
          clobTokenIds: "[\"yes-token-2\", \"no-token-2\"]",
        },
      ],
    });

    const family = classifyMarketFamily(event);

    expect(family.classification).toBe("grouped_date_threshold");
    expect(family.eventEndDate).toBeNull();
    expect(family.childMarkets).toHaveLength(2);
  });

  it("classifies grouped exact-date families", () => {
    const event = parseEvent({
      id: "event-3",
      title: "Military action against Iran ends on...?",
      slug: "military-action-against-iran-ends-on",
      endDate: "2026-03-31T00:00:00Z",
      showAllOutcomes: true,
      markets: [
        {
          id: "market-4",
          question: "Military action against Iran ends on March 21, 2026?",
          conditionId: "cond-4",
          slug: "military-action-against-iran-ends-on-march-21-2026",
          endDate: "2026-03-31T00:00:00Z",
          groupItemTitle: "March 21",
          groupItemThreshold: "10",
          liquidity: "10161.26028",
          volume: "3199.7982679999986",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0.015\", \"0.985\"]",
          clobTokenIds: "[\"yes-token\", \"no-token\"]",
        },
        {
          id: "market-5",
          question: "Military action against Iran ends on March 31, 2026?",
          conditionId: "cond-5",
          slug: "military-action-against-iran-ends-on-march-31-2026",
          endDate: "2026-03-31T00:00:00Z",
          groupItemTitle: "March 31",
          groupItemThreshold: "20",
          liquidity: "12634.59958",
          volume: "37520.496768000005",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0.0375\", \"0.9625\"]",
          clobTokenIds: "[\"yes-token-2\", \"no-token-2\"]",
        },
      ],
    });

    expectClassification(event, "grouped_exact_date");
  });

  it("classifies candidate field families and excludes inactive placeholder children", () => {
    const event = parseEvent({
      id: "event-4",
      title: "Republican Presidential Nominee 2028",
      slug: "republican-presidential-nominee-2028",
      endDate: "2028-11-07T00:00:00Z",
      showAllOutcomes: true,
      markets: [
        {
          id: "market-6",
          question: "Will J.D. Vance win the 2028 Republican presidential nomination?",
          conditionId: "cond-6",
          slug: "will-jd-vance-win-the-2028-republican-presidential-nomination",
          endDate: "2028-11-07T00:00:00Z",
          groupItemTitle: "J.D. Vance",
          groupItemThreshold: "1",
          liquidity: "303301.30038",
          volume: "5546831.399537822",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0.3875\", \"0.6125\"]",
          clobTokenIds: "[\"yes-token\", \"no-token\"]",
        },
        {
          id: "market-7",
          question: "Will Marco Rubio win the 2028 Republican presidential nomination?",
          conditionId: "cond-7",
          slug: "will-marco-rubio-win-the-2028-republican-presidential-nomination",
          endDate: "2028-11-07T00:00:00Z",
          groupItemTitle: "Marco Rubio",
          groupItemThreshold: "2",
          liquidity: "518572.74202",
          volume: "5641687.068676058",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0.2775\", \"0.7225\"]",
          clobTokenIds: "[\"yes-token-2\", \"no-token-2\"]",
        },
        {
          id: "market-8",
          question: "Will Person BN win the 2028 Republican presidential nomination?",
          conditionId: "cond-8",
          slug: "will-person-bn-win-the-2028-republican-presidential-nomination-327",
          endDate: "2028-11-07T00:00:00Z",
          groupItemTitle: "Person BN",
          groupItemThreshold: "88",
          liquidity: "0",
          volume: "0",
          active: false,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0\", \"1\"]",
          clobTokenIds: "[\"yes-token-3\", \"no-token-3\"]",
        },
      ],
    });

    const family = classifyMarketFamily(event);

    expect(family.classification).toBe("candidate_field");
    expect(family.childMarkets).toHaveLength(2);
    expect(family.childMarkets.map((child) => child.groupItemTitle)).toEqual(["J.D. Vance", "Marco Rubio"]);
  });

  it("classifies mention and count families", () => {
    const event = parseEvent({
      id: "event-5",
      title: "What will Trump say this week (March 8)?",
      slug: "what-will-trump-say-this-week-march-8",
      endDate: "2026-03-08T00:00:00Z",
      showAllOutcomes: true,
      markets: [
        {
          id: "market-9",
          question: "Will Trump say \"El Salvador\" this week? (March 8)",
          conditionId: "cond-9",
          slug: "will-trump-say-el-salvador-this-week-march-8",
          endDate: "2026-03-08T00:00:00Z",
          groupItemTitle: "El Salvador",
          groupItemThreshold: "2",
          liquidity: "12000",
          volume: "50000",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"1\", \"0\"]",
          clobTokenIds: "[\"yes-token\", \"no-token\"]",
        },
        {
          id: "market-10",
          question: "Will Trump say \"Shutdown\" or \"Shut down\" this week? (March 8)",
          conditionId: "cond-10",
          slug: "will-trump-say-shutdown-or-shut-down-this-week-march-8",
          endDate: "2026-03-08T00:00:00Z",
          groupItemTitle: "Shutdown / Shut down",
          groupItemThreshold: "7",
          liquidity: "9000",
          volume: "3118.612212",
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"1\", \"0\"]",
          clobTokenIds: "[\"yes-token-2\", \"no-token-2\"]",
        },
      ],
    });

    expectClassification(event, "mention_count_family");
  });

  it("parses grouped event children when liquidity and volume are null", () => {
    const event = parseEvent({
      id: "event-6",
      title: "US x Iran ceasefire by...?",
      slug: "us-x-iran-ceasefire-by",
      endDate: null,
      showAllOutcomes: true,
      markets: [
        {
          id: "market-11",
          question: "US x Iran ceasefire by March 6?",
          conditionId: "cond-11",
          slug: "us-x-iran-ceasefire-by-march-6",
          endDate: null,
          groupItemTitle: "March 6",
          groupItemThreshold: "1",
          liquidity: null,
          volume: null,
          active: true,
          closed: false,
          outcomes: "[\"Yes\", \"No\"]",
          outcomePrices: "[\"0\", \"1\"]",
          clobTokenIds: "[\"yes-token\", \"no-token\"]",
        },
      ],
    });

    const family = classifyMarketFamily(event);

    expect(family.classification).toBe("grouped_date_threshold");
    expect(family.childMarkets[0]?.liquidity).toBe(0);
    expect(family.childMarkets[0]?.volume).toBe(0);
  });
});
