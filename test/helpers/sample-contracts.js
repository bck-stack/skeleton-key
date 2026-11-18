/**
 * Contract objects used by tests. `foodContract()` is the openFDA example from
 * `.kiro/steering/source-contracts.md`. Each call returns a fresh object.
 */

export function foodContract() {
  return {
    source: "openfda-food-enforcement",
    tool: {
      name: "recalls_search_food",
      description:
        "Returns FDA food recall enforcement reports (recall number, product, reason, classification, status, date, firm), at most 'limit' records, newest first. Use when asked whether a food product or firm has been recalled in the US. An empty list means no matching records. Do not use for drugs (use recalls_search_drug) or non-food consumer products (use recalls_search_consumer).",
    },
    params: {
      product: {
        type: "string", required: true, maxLength: 100, escape: "lucene",
        description: "Words from the product description, for example a brand or food name.",
        example: "peanut butter",
      },
      date_from: {
        type: "date", format: "yyyymmdd",
        description: "Earliest report date, YYYY-MM-DD, inclusive.",
        example: "2024-01-01",
      },
      limit: {
        type: "integer", default: 10, minimum: 1, maximum: 50,
        description: "Maximum number of records to return, 1 to 50.",
        example: 10,
      },
    },
    request: {
      baseUrl: "https://api.fda.gov/food/enforcement.json",
      query: [
        { key: "search", template: 'product_description:"{product}"', joinWith: " AND " },
        { key: "search", template: "report_date:[{date_from} TO 29991231]", joinWith: " AND " },
        { key: "sort", template: "report_date:desc" },
        { key: "limit", template: "{limit}" },
      ],
      timeoutMs: 8000,
      cacheSeconds: 60,
    },
    response: {
      recordsPath: "results",
      noMatch: { status: [404] },
      fields: {
        recall_number: { from: "recall_number", transform: ["trim"], type: "string", required: true, description: "FDA recall number." },
        product: { from: "product_description", transform: ["trim"], type: "string", required: true, description: "Recalled product." },
        reason: { from: "reason_for_recall", transform: ["trim"], type: "string", description: "Why it was recalled." },
        classification: { from: "classification", transform: ["trim"], type: "string", description: "Class I, II or III." },
        status: { from: "status", transform: ["trim", "lower"], type: "string", description: "Ongoing, completed or terminated." },
        date: { from: "report_date", transform: ["yyyymmddToIso"], type: "string", description: "Report date, ISO date." },
        firm: { from: "recalling_firm", transform: ["trim"], type: "string", description: "Recalling company." },
        link: {
          template: 'https://api.fda.gov/food/enforcement.json?search=recall_number:"{recall_number}"',
          type: "string", description: "Machine-readable record URL.",
        },
      },
    },
    fixture: {
      input: { product: "peanut butter", limit: 2 },
      expectedUrl:
        "https://api.fda.gov/food/enforcement.json?search=product_description%3A%22peanut%20butter%22&sort=report_date%3Adesc&limit=2",
      status: 200,
      body: {
        meta: { results: { skip: 0, limit: 2, total: 2 } },
        results: [
          { recall_number: "F-0123-2024", product_description: " Peanut butter, 16 oz jar ", reason_for_recall: "Undeclared milk.", classification: "Class I", status: "Ongoing", report_date: "20240115", recalling_firm: "Example Foods Inc." },
          { recall_number: "F-0456-2023", product_description: "Peanut butter cups", reason_for_recall: "Salmonella.", classification: "Class II", status: "Terminated", report_date: "20231102", recalling_firm: "Sample Candy Co." },
        ],
      },
    },
  };
}

/** A small second contract with different names, for uniqueness tests. */
export function minimalContract(overrides = {}) {
  return {
    source: "demo-source",
    tool: {
      name: "demo_search",
      description: "Returns demo rows. Use when testing. Do not use for real data.",
    },
    params: {
      q: { type: "string", description: "Search words.", example: "abc" },
    },
    request: { baseUrl: "https://example.com/api", query: [{ key: "q", template: "{q}" }] },
    response: {
      recordsPath: "results",
      fields: { id: { from: "id", type: "string", description: "Row id." } },
    },
    fixture: { input: { q: "abc" }, status: 200, body: { results: [{ id: "1" }] } },
    ...overrides,
  };
}
