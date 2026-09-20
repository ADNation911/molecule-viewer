const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/;

export function normalizePdbId(value) {
  const id = String(value || '').trim().toUpperCase();
  if (!PDB_ID.test(id)) throw new Error('Enter a four-character PDB ID, for example 1D66.');
  return id;
}

export async function fetchPdbStructure(value, request = fetch) {
  const id = normalizePdbId(value);
  let response;
  try {
    response = await request(`https://files.rcsb.org/download/${id}.cif`, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error(`Could not reach RCSB PDB for ${id}. Check your connection and try again.`);
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error(`RCSB PDB has no structure with ID ${id}.`);
    throw new Error(`RCSB PDB returned an error for ${id}. Try again later.`);
  }
  return { id, text: await response.text(), source: `https://www.rcsb.org/structure/${id}` };
}
