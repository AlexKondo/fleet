#!/usr/bin/env node
// L2: table-driven test of public.carpool_coarse_label() against realistic Brazilian address formats,
// through live SQL (the repo has no TS mirror of SQL functions, so the function itself is exercised).
//
//   node supabase/tests/coarse-label-table.mjs                 # against the function currently live
//   node supabase/tests/coarse-label-table.mjs --in-txn FILE   # run FILE (a migration) inside a rolled-back
//                                                              # transaction first, then the table
import { readFileSync } from 'node:fs';
import { sql, record, summary } from './lib/live.mjs';

// [input, expected output]
export const CASES = [
  ['Alameda Santos 1000 apto 81, Cerqueira César', 'Alameda Santos, Cerqueira César'],
  ['Alameda Santos, 1000, apto 81, Cerqueira César, São Paulo - SP, 01419-001, Brazil', 'Alameda Santos, Cerqueira César'],
  ['Condomínio Residencial Jardins, Bloco B', null],
  ['Condomínio Residencial Jardins, Bloco B, Rua Ypiranga, 100, Centro, Campinas - SP', 'Rua Ypiranga, Centro'],
  ['Rod. Anhanguera, km 98, Jundiaí - SP', 'Rod. Anhanguera, Jundiaí'],
  ['Rod. Anhanguera km 98', 'Rod. Anhanguera'],
  ['Rodovia dos Bandeirantes, Km 45,5, Jundiaí', 'Rodovia dos Bandeirantes, Jundiaí'],
  ['Rodovia SP-330, km 100, Ribeirão Preto', 'Rodovia SP-330, Ribeirão Preto'],
  ['R. Cel. Xavier de Toledo, Sala 42, República', 'R. Cel. Xavier de Toledo, República'],
  ['R. Cel. Xavier de Toledo, Sala', 'R. Cel. Xavier de Toledo'],
  ['R. Cel. Xavier de Toledo, 114 - República, São Paulo - SP, 01048-100, Brasil', 'R. Cel. Xavier de Toledo, República'],
  ['Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200, Brazil', 'Av. Paulista, Bela Vista'],
  ['Av. Brigadeiro Faria Lima, 3477 - Itaim Bibi, São Paulo - SP', 'Av. Brigadeiro Faria Lima, Itaim Bibi'],
  ['Rua 25 de Março, 100, Centro', 'Rua 25 de Março, Centro'],
  ['Rua 25 de Março 100 bloco 2 apto 31, Centro', 'Rua 25 de Março, Centro'],
  ['Avenida 9 de Julho, 3452, Jardim Paulista', 'Avenida 9 de Julho, Jardim Paulista'],
  ['Rua XV de Novembro, 200 - Centro, Curitiba - PR', 'Rua XV de Novembro, Centro'],
  ['Praça da Sé s/n, Sé, São Paulo', 'Praça da Sé, Sé'],
  ['Rua das Flores, s/n, Vila Mariana', 'Rua das Flores, Vila Mariana'],
  ['Rua das Flores nº 45, Vila Mariana', 'Rua das Flores, Vila Mariana'],
  ['Rua das Flores n 45A, Vila Mariana', 'Rua das Flores, Vila Mariana'],
  ['Rua das Flores 45A', 'Rua das Flores'],
  ['1000 Main Street, Springfield', 'Main Street, Springfield'],
  ['Edifício Itália, Av. Ipiranga, 344, Centro, São Paulo - SP', 'Av. Ipiranga, Centro'],
  ['Shopping Ibirapuera, Av. Ibirapuera, 3103, Moema', 'Av. Ibirapuera, Moema'],
  ['Torre B, Rua Gomes de Carvalho, 1996, Vila Olímpia', 'Rua Gomes de Carvalho, Vila Olímpia'],
  ['Rua Casa Verde 10, Casa Verde', 'Rua Casa Verde, Casa Verde'],
  ['Estrada do M\'Boi Mirim, 2500 casa 3, Jardim Ângela', 'Estrada do M\'Boi Mirim, Jardim Ângela'],
  ['Avenida Rio Branco, 156, Conj. 1201, Centro, Rio de Janeiro - RJ, 20040-901', 'Avenida Rio Branco, Centro'],
  ['Rua Augusta, 2690, ap 12, Jardins', 'Rua Augusta, Jardins'],
  ['Travessa dos Ferroviários, Quadra 4 Lote 12, Vila Nova', 'Travessa dos Ferroviários, Vila Nova'],
  ['Rua Teodoro Sampaio, 1020 - Pinheiros', 'Rua Teodoro Sampaio, Pinheiros'],
  ['Av. Eng. Luís Carlos Berrini, 1.500, Brooklin', 'Av. Eng. Luís Carlos Berrini, Brooklin'],
  ['-23.5505, -46.6333', null],
  ['01310-100', null],
  ['', null],
  ['Brasil', null],
];

const inTxn = process.argv.includes('--in-txn') ? process.argv[process.argv.indexOf('--in-txn') + 1] : null;
const lit = (s) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);

async function main() {
  const values = CASES.map(([inp], i) => `(${i}, ${lit(inp)})`).join(',\n');
  const select = `select i, public.carpool_coarse_label(t) as out from (values ${values}) v(i, t) order by i`;
  const rows = inTxn
    ? await sql(`begin;\n${readFileSync(inTxn, 'utf8')}\n${select};\nrollback;`)
    : await sql(select);
  const out = new Map(rows.map((r) => [Number(r.i), r.out]));
  console.log(`${'#'.padEnd(3)} ${'INPUT'.padEnd(88)} OUTPUT`);
  CASES.forEach(([inp, exp], i) => {
    const got = out.get(i) ?? null;
    const ok = got === exp;
    record(`coarse label #${i + 1}: ${JSON.stringify(inp)}`, ok, ok ? `-> ${JSON.stringify(got)}` : `got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`);
  });
  // structural guarantees over every output: no digits, no postal code, no dangling unit/km token
  for (const [i, v] of out) {
    if (v === null) continue;
    const bad = (/\d/.test(v) && !/\d/.test(CASES[i][1] ?? '')) || /(^|[\s,])(apto|apt|ap|bloco|bl|torre|sala|conj|conjunto|cj|andar|loja|km|nº)\.?(,|$)/i.test(v) || /,\s*$/.test(v);
    if (bad) record(`coarse label #${i + 1} structural guarantee (no digits / dangling token)`, false, v);
  }
  return summary('coarse label');
}
main().then((f) => process.exit(f ? 1 : 0));
