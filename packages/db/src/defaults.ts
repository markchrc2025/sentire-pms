/** Built-in taxes and discounts every new property starts with (CLAUDE.md domain rules 2 and 3). */
export function defaultTaxFees(organizationId: string, propertyId: string) {
  return [
    { organizationId, propertyId, code: "VAT", name: "VAT 12%", kind: "TAX" as const, calc: "PERCENT" as const, basis: "PER_NIGHT" as const, value: 1200n, inclusive: true, glCode: "2105-VAT-OUTPUT", system: true },
    { organizationId, propertyId, code: "SC", name: "Senior citizen 20%", kind: "DISCOUNT" as const, calc: "PERCENT" as const, basis: "PER_NIGHT" as const, value: 2000n, inclusive: false, glCode: "4190-SC-DISCOUNT", system: true },
    { organizationId, propertyId, code: "PWD", name: "PWD 20%", kind: "DISCOUNT" as const, calc: "PERCENT" as const, basis: "PER_NIGHT" as const, value: 2000n, inclusive: false, glCode: "4191-PWD-DISCOUNT", system: true },
  ];
}
