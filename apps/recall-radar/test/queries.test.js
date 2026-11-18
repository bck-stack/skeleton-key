/**
 * Request building for each recall tool, one expected URL per case
 * (recall-radar requirements 2.1 to 2.5, 3.1, 4.2, design section 6).
 */
import { describe, it, expect } from "vitest";
import { load, urlOf, paramsOf, freshDeps } from "./helpers.js";
import { runSource } from "../../../packages/core/src/index.js";
import { makeFetch } from "../../../test/helpers/stub-fetch.js";

const FOOD = "https://api.fda.gov/food/enforcement.json";

describe("recalls_search_food: request building", () => {
  const food = load("food");
  const search = async (input) => paramsOf(await urlOf(food, input)).search;

  it("product only", async () => {
    expect(await urlOf(food, { product: "peanut butter", limit: 3 })).toBe(
      `${FOOD}?search=product_description%3A%22peanut%20butter%22&sort=report_date%3Adesc&limit=3`,
    );
  });

  it("firm only", async () => {
    expect(await search({ firm: "Acme Foods" })).toBe('recalling_firm:"Acme Foods"');
  });

  it("product and firm are ANDed, product first", async () => {
    expect(await search({ product: "cheese", firm: "Acme" })).toBe(
      'product_description:"cheese" AND recalling_firm:"Acme"',
    );
  });

  it("date range gives two clauses that together are the closed range, as YYYYMMDD", async () => {
    expect(await search({ date_from: "2025-01-01", date_to: "2025-03-31" })).toBe(
      "report_date:[20250101 TO 29991231] AND report_date:[19000101 TO 20250331]",
    );
  });

  it("date_from only", async () => {
    expect(await search({ date_from: "2024-06-30" })).toBe("report_date:[20240630 TO 29991231]");
  });

  it("date_to only", async () => {
    expect(await search({ date_to: "2024-06-30" })).toBe("report_date:[19000101 TO 20240630]");
  });

  it("all filters, in the order product, firm, date_from, date_to", async () => {
    expect(await search({ product: "a", firm: "b", date_from: "2024-01-02", date_to: "2024-03-04" })).toBe(
      'product_description:"a" AND recalling_firm:"b" AND report_date:[20240102 TO 29991231] AND report_date:[19000101 TO 20240304]',
    );
  });

  it("no filters sends no search key: the newest recalls (requirement 2.2)", async () => {
    const url = await urlOf(food, {});
    expect(url).toBe(`${FOOD}?sort=report_date%3Adesc&limit=10`);
    expect(paramsOf(url)).not.toHaveProperty("search");
  });

  it("an empty input object is valid and applies the default limit", async () => {
    expect(paramsOf(await urlOf(food, {})).limit).toBe("10");
  });
});

const DRUG = "https://api.fda.gov/drug/enforcement.json";

describe("recalls_search_drug: request building", () => {
  const drug = load("drug");
  const search = async (input) => paramsOf(await urlOf(drug, input)).search;

  it("product only, over the drug endpoint", async () => {
    expect(await urlOf(drug, { product: "aspirin", limit: 3 })).toBe(
      `${DRUG}?search=product_description%3A%22aspirin%22&sort=report_date%3Adesc&limit=3`,
    );
  });

  it("firm only", async () => {
    expect(await search({ firm: "Pfizer" })).toBe('recalling_firm:"Pfizer"');
  });

  it("product and firm", async () => {
    expect(await search({ product: "aspirin", firm: "Bayer" })).toBe(
      'product_description:"aspirin" AND recalling_firm:"Bayer"',
    );
  });

  it("date range, date_from only and date_to only", async () => {
    expect(await search({ date_from: "2025-01-01", date_to: "2025-03-31" })).toBe(
      "report_date:[20250101 TO 29991231] AND report_date:[19000101 TO 20250331]",
    );
    expect(await search({ date_from: "2025-01-01" })).toBe("report_date:[20250101 TO 29991231]");
    expect(await search({ date_to: "2025-03-31" })).toBe("report_date:[19000101 TO 20250331]");
  });

  it("no filters sends no search key", async () => {
    expect(await urlOf(drug, {})).toBe(`${DRUG}?sort=report_date%3Adesc&limit=10`);
  });
});

const CPSC = "https://www.saferproducts.gov/RestWebServices/Recall";

describe("recalls_search_consumer: request building", () => {
  const cpsc = load("cpsc");
  it("product and date_from (the fixture input), format=json first", async () => {
    expect(await urlOf(cpsc, { product: "stroller", date_from: "2025-01-01" })).toBe(
      `${CPSC}?format=json&ProductName=stroller&RecallDateStart=2025-01-01`,
    );
  });

  it("product only", async () => {
    expect(await urlOf(cpsc, { product: "baby gate" })).toBe(`${CPSC}?format=json&ProductName=baby%20gate`);
  });

  it("firm only maps to Manufacturer", async () => {
    expect(await urlOf(cpsc, { firm: "Graco" })).toBe(`${CPSC}?format=json&Manufacturer=Graco`);
  });

  it("product and firm", async () => {
    expect(await urlOf(cpsc, { product: "stroller", firm: "Graco" })).toBe(
      `${CPSC}?format=json&ProductName=stroller&Manufacturer=Graco`,
    );
  });

  it("date range keeps YYYY-MM-DD", async () => {
    expect(await urlOf(cpsc, { date_from: "2025-01-01", date_to: "2025-03-31" })).toBe(
      `${CPSC}?format=json&RecallDateStart=2025-01-01&RecallDateEnd=2025-03-31`,
    );
  });

  it("date_to alone is rejected before any request (RR-P10)", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: [] }));
    const out = await runSource(cpsc, { date_to: "2025-03-31" }, freshDeps(fetch));
    expect(out.error.code).toBe("INVALID_INPUT");
    expect(fetch.calls).toHaveLength(0);
  });

  it("no filters is rejected before any request (RR-P10)", async () => {
    const fetch = makeFetch(() => ({ status: 200, body: [] }));
    const out = await runSource(cpsc, {}, freshDeps(fetch));
    expect(out.error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
    expect(out.error.message).toBe("product: give at least one of product, firm, date_from");
    expect(fetch.calls).toHaveLength(0);
  });

  it("date_to with date_from keeps both", async () => {
    expect(await urlOf(cpsc, { date_from: "2025-01-01", date_to: "2025-03-31" })).toContain("RecallDateEnd=2025-03-31");
  });

  it("has no limit parameter: the 25-record cap is in the contract", async () => {
    expect(Object.keys(cpsc.params)).not.toContain("limit");
    expect(cpsc.response.maxRecords).toBe(25);
  });
});
