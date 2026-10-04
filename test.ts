import { Csv } from "./dist/index.js";

const writerStream = Csv.writer({
  delimiter: ";",
  headers: ["id", "nom", "prix"],
});

writerStream.writable.getWriter();

// Récupération de l'écrivain
const writer = writerStream.writable.getWriter();

// Écriture de quelques lignes
await writer.write({ id: 1, nom: "Disque SSD", prix: "89.00" });
await writer.write({ id: 2, nom: 'Câble "USB-C"', prix: "9.99" });
await writer.close();

// Consommation du texte CSV généré au fil de l'eau
for await (const chunk of writerStream.readable) {
  console.log(chunk);
}