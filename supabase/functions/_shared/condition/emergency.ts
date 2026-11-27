// The medical emergency number by the phone's region (ISO 3166-1 alpha-2), checked against each
// country's government or health-ministry source; the sources are listed in docs/architecture.md#red-flags-and-urgent-care.
const NUMBERS: ReadonlyMap<string, string> = new Map([
  // Latin America: the medical line where it differs from the police one (SAME, SAMU, SEM).
  // argentina.gob.ar/tema/emergencias; minsal.cl; bogota.gov.co and cali.gov.co (Línea 123);
  // gob.pe/minsa (SAMU 106); ministeriodesalud.go.cr and Ley 7566 (9-1-1); Ley 44 de 2007 (SUME 9-1-1);
  // Ley 140-13 and minpre.gob.do (9-1-1); gob.ec/ecu-911; gob.mx (9-1-1); transparencia.gob.sv/minsal (SEM 132);
  // gub.uy (9-1-1 dispatches SAME 105); iaip.gob.hn (SNE 911 and its UREM ambulances); sld.cu (SIUM 104);
  // Gaceta Oficial 41.711 of 2019 (VEN 911; Conatel's 171 dates from a 2003 resolution); bomberosvoluntarios.org.gt
  // (122). Bolivia (168), Paraguay (141) and Nicaragua (128, the Red Cross line, dissolved in 2023) have no
  // number confirmed as operating, so they get the local-number screen.
  ['AR', '107'],
  ['CL', '131'],
  ['CO', '123'],
  ['CR', '911'],
  ['CU', '104'],
  ['DO', '911'],
  ['EC', '911'],
  ['GT', '122'],
  ['HN', '911'],
  ['MX', '911'],
  ['PA', '911'],
  ['PE', '106'],
  ['SV', '132'],
  ['UY', '911'],
  ['VE', '911'],
  // Brazil: gov.br/saude (SAMU 192).
  ['BR', '192'],
  // United States and Canada: 911.gov; alberta.ca and quebec.ca. Puerto Rico: Ley 144-1994, the
  // Negociado de Sistemas de Emergencias 9-1-1 (docs.pr.gov, hacienda.pr.gov).
  ['US', '911'],
  ['CA', '911'],
  ['PR', '911'],
  // Spain and Portugal: administracion.gob.es and gov.pt (112). United Kingdom: nhs.uk (999).
  ['ES', '112'],
  ['PT', '112'],
  ['GB', '999'],
]);

/** The regions with a known number. */
export const emergencyRegions: readonly string[] = Object.freeze([...NUMBERS.keys()]);

/** Null for a region with no clear official number, so the screen sends the user to their local one. */
export function emergencyNumber(region: string | null): string | null {
  return region === null ? null : (NUMBERS.get(region.toUpperCase()) ?? null);
}
