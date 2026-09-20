const base = import.meta.env.BASE_URL;
export const samples = {
  gal4: { name: '1D66.pdb', title: 'GAL4–DNA complex', description: 'DNA recognition by GAL4: a protein–DNA complex from yeast.', url: `${base}samples/1D66.pdb`, source: 'https://www.rcsb.org/structure/1D66' },
  myoglobin: { name: '3RGK.pdb', title: 'Human myoglobin', description: 'Crystal structure of human myoglobin, K45R mutant.', url: `${base}samples/3RGK.pdb`, source: 'https://www.rcsb.org/structure/3RGK' },
  ethanol: { name: 'ethanol.xyz', title: 'Ethanol', description: 'C₂H₆O · Illustrative coordinates for exploring atom and bond representations. Bonds are inferred from distance.', url: `${base}samples/ethanol.xyz` },
};
