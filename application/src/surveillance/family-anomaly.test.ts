import { describe, expect, it } from "vitest";
import { detectFamilyAnomaly } from "./family-anomaly.js";

describe("detectFamilyAnomaly", () => {
  it("flags a one-child spike when a single child reprices aggressively against quiet siblings", () => {
    const anomaly = detectFamilyAnomaly({
      familySlug: "us-x-iran-ceasefire-by",
      classification: "grouped_date_threshold",
      children: [
        {
          slug: "us-x-iran-ceasefire-by-march-31",
          label: "March 31",
          thresholdIndex: 3,
          currentPrice: 0.42,
          priceChange5m: 0.19,
          priceChange1h: 0.24,
          volume1h: 240000,
          volume24h: 900000,
          liquidity: 140000,
          openInterest: 300000,
        },
        {
          slug: "us-x-iran-ceasefire-by-april-30",
          label: "April 30",
          thresholdIndex: 4,
          currentPrice: 0.45,
          priceChange5m: 0.01,
          priceChange1h: 0.03,
          volume1h: 12000,
          volume24h: 350000,
          liquidity: 180000,
          openInterest: 260000,
        },
        {
          slug: "us-x-iran-ceasefire-by-may-31",
          label: "May 31",
          thresholdIndex: 5,
          currentPrice: 0.52,
          priceChange5m: -0.01,
          priceChange1h: 0.02,
          volume1h: 9000,
          volume24h: 280000,
          liquidity: 150000,
          openInterest: 210000,
        },
      ],
    });

    expect(anomaly.pattern).toBe("one_child_spike");
    expect(anomaly.severity).toBe("high");
    expect(anomaly.impactedChildren).toEqual(["us-x-iran-ceasefire-by-march-31"]);
    expect(anomaly.reasons).toContain("single child repriced sharply relative to siblings");
  });

  it("flags adjacent bucket spikes when neighboring date buckets move together", () => {
    const anomaly = detectFamilyAnomaly({
      familySlug: "military-action-against-iran-ends-on",
      classification: "grouped_exact_date",
      children: [
        {
          slug: "march-20",
          label: "March 20",
          thresholdIndex: 9,
          currentPrice: 0.16,
          priceChange5m: 0.11,
          priceChange1h: 0.14,
          volume1h: 46000,
          volume24h: 150000,
          liquidity: 12000,
          openInterest: 45000,
        },
        {
          slug: "march-21",
          label: "March 21",
          thresholdIndex: 10,
          currentPrice: 0.18,
          priceChange5m: 0.1,
          priceChange1h: 0.13,
          volume1h: 48000,
          volume24h: 155000,
          liquidity: 12500,
          openInterest: 47000,
        },
        {
          slug: "march-24",
          label: "March 24",
          thresholdIndex: 13,
          currentPrice: 0.02,
          priceChange5m: 0.01,
          priceChange1h: 0.02,
          volume1h: 2000,
          volume24h: 12000,
          liquidity: 10000,
          openInterest: 10000,
        },
      ],
    });

    expect(anomaly.pattern).toBe("adjacent_bucket_spike");
    expect(anomaly.impactedChildren).toEqual(["march-20", "march-21"]);
    expect(anomaly.reasons).toContain("adjacent thresholds moved together");
  });

  it("flags rotation when one sibling falls as another rises in the same family", () => {
    const anomaly = detectFamilyAnomaly({
      familySlug: "republican-presidential-nominee-2028",
      classification: "candidate_field",
      children: [
        {
          slug: "jd-vance",
          label: "J.D. Vance",
          thresholdIndex: 1,
          currentPrice: 0.34,
          priceChange5m: -0.09,
          priceChange1h: -0.12,
          volume1h: 210000,
          volume24h: 1000000,
          liquidity: 300000,
          openInterest: 700000,
        },
        {
          slug: "marco-rubio",
          label: "Marco Rubio",
          thresholdIndex: 2,
          currentPrice: 0.33,
          priceChange5m: 0.1,
          priceChange1h: 0.14,
          volume1h: 235000,
          volume24h: 1100000,
          liquidity: 320000,
          openInterest: 730000,
        },
        {
          slug: "ron-desantis",
          label: "Ron DeSantis",
          thresholdIndex: 6,
          currentPrice: 0.03,
          priceChange5m: -0.01,
          priceChange1h: 0.0,
          volume1h: 8000,
          volume24h: 80000,
          liquidity: 120000,
          openInterest: 120000,
        },
      ],
    });

    expect(anomaly.pattern).toBe("rotation");
    expect(anomaly.impactedChildren).toEqual(["jd-vance", "marco-rubio"]);
    expect(anomaly.reasons).toContain("capital rotated between sibling contracts");
  });

  it("flags broad repricing when most of the family moves in the same direction", () => {
    const anomaly = detectFamilyAnomaly({
      familySlug: "republican-presidential-nominee-2028",
      classification: "candidate_field",
      children: [
        { slug: "jd-vance", label: "J.D. Vance", thresholdIndex: 1, currentPrice: 0.44, priceChange5m: -0.09, priceChange1h: -0.11, volume1h: 110000, volume24h: 600000, liquidity: 300000, openInterest: 700000 },
        { slug: "marco-rubio", label: "Marco Rubio", thresholdIndex: 2, currentPrice: 0.25, priceChange5m: -0.08, priceChange1h: -0.09, volume1h: 105000, volume24h: 550000, liquidity: 320000, openInterest: 730000 },
        { slug: "ron-desantis", label: "Ron DeSantis", thresholdIndex: 6, currentPrice: 0.02, priceChange5m: -0.07, priceChange1h: -0.08, volume1h: 98000, volume24h: 500000, liquidity: 120000, openInterest: 120000 },
        { slug: "donald-trump", label: "Donald Trump", thresholdIndex: 0, currentPrice: 0.01, priceChange5m: -0.1, priceChange1h: -0.12, volume1h: 99000, volume24h: 510000, liquidity: 150000, openInterest: 180000 },
      ],
    });

    expect(anomaly.pattern).toBe("broad_repricing");
    expect(anomaly.severity).toBe("medium");
    expect(anomaly.reasons).toContain("most active children repriced in the same direction");
  });

  it("returns no anomaly for ordinary noise", () => {
    const anomaly = detectFamilyAnomaly({
      familySlug: "us-x-iran-ceasefire-by",
      classification: "grouped_date_threshold",
      children: [
        { slug: "march-31", label: "March 31", thresholdIndex: 3, currentPrice: 0.24, priceChange5m: 0.01, priceChange1h: 0.02, volume1h: 6000, volume24h: 120000, liquidity: 200000, openInterest: 250000 },
        { slug: "april-30", label: "April 30", thresholdIndex: 4, currentPrice: 0.46, priceChange5m: -0.01, priceChange1h: 0.01, volume1h: 7000, volume24h: 115000, liquidity: 180000, openInterest: 240000 },
        { slug: "may-31", label: "May 31", thresholdIndex: 5, currentPrice: 0.54, priceChange5m: 0.0, priceChange1h: -0.02, volume1h: 5000, volume24h: 110000, liquidity: 170000, openInterest: 220000 },
      ],
    });

    expect(anomaly.pattern).toBe("none");
    expect(anomaly.impactedChildren).toEqual([]);
  });
});
