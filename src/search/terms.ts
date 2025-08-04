/**
 * Search term expansion and abbreviations
 */

export const expandedTerms: Record<string, string[]> = {
  str: ["structure"],
  struct: ["structure"],
  def: ["definition"],
  pati: ["patient"],
  obs: ["observation"],
  org: ["organization"],
  pract: ["practitioner"],
  med: ["medication", "medicinal"],
  req: ["request"],
  resp: ["response"],
  ref: ["reference"],
  val: ["value"],
  code: ["codesystem", "code"],
  cs: ["codesystem"],
  vs: ["valueset"],
  sd: ["structuredefinition"],
};