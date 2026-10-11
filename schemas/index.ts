/**
 * The API contract.
 *
 * Everything a client needs to know about the shape of this API is derivable
 * from this barrel. Route handlers parse with these schemas and serialise
 * through them, so a schema change is a contract change and shows up as a
 * compile error rather than a runtime surprise.
 *
 * Import from `@/schemas` rather than the individual modules.
 */

export * from "@/schemas/common";
export * from "@/schemas/user";
export * from "@/schemas/semester";
export * from "@/schemas/course";
export * from "@/schemas/attendance";
export * from "@/schemas/assessment";
export * from "@/schemas/result";
export * from "@/schemas/grade";
export * from "@/schemas/deadline";
export * from "@/schemas/notification";
