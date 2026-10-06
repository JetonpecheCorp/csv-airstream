import { CsvWriterOptions } from "./types/CsvOption.js";

export type RowInput = unknown[] | object;

class CsvWriterEngine
{
    private readonly separateur: string;
    private readonly caractereGuillemet: string;
    private readonly finDeLigne: string;
    private readonly guillemetsSystematiques: boolean;
    private readonly enTetes?: string[];
    private readonly clesProprietes?: string[];
    private readonly regexGuillemetsRequis: RegExp;
    private enTeteEcrite = false;

    constructor(options: CsvWriterOptions)
    {
        this.separateur = options.delimiter ?? ",";
        this.caractereGuillemet = options.quoteChar ?? '"';
        this.finDeLigne = options.lineTerminator ?? "\r\n";
        this.guillemetsSystematiques = options.alwaysQuote ?? false;
        this.enTetes = options.headers;
        this.clesProprietes = options.propertyKeys;

        const separateurEchappe = this.echapperRegex(this.separateur);
        const guillemetEchappe = this.echapperRegex(this.caractereGuillemet);
        this.regexGuillemetsRequis = new RegExp(`[${separateurEchappe}${guillemetEchappe}\\r\\n]`);
    }

    public writeRow(
        ligne: RowInput,
        controller: TransformStreamDefaultController<string>
    ): void
    {
        if (!this.enTeteEcrite)
        {
            this.ecrireEnTetesSiBesoin(ligne, controller);
            this.enTeteEcrite = true;
        }

        const cellules: string[] = [];

        if (Array.isArray(ligne))
        {
            for (let i = 0; i < ligne.length; i++)
            {
                cellules.push(this.formaterCellule(ligne[i]));
            }
        }
        else if (typeof ligne === "object" && ligne !== null)
        {
            const enregistrement = ligne as Record<string, unknown>;

            // Chemin O(1) si les propriétés sont pré-calculées par le décorateur
            if (this.clesProprietes)
            {
                for (let i = 0; i < this.clesProprietes.length; i++)
                {
                    cellules.push(this.formaterCellule(enregistrement[this.clesProprietes[i]]));
                }
            }
            else
            {
                const cles = this.enTetes ?? Object.keys(enregistrement);
                for (let i = 0; i < cles.length; i++)
                {
                    cellules.push(this.formaterCellule(enregistrement[cles[i]]));
                }
            }
        }

        controller.enqueue(cellules.join(this.separateur) + this.finDeLigne);
    }

    private ecrireEnTetesSiBesoin(
        premiereLigne: RowInput,
        controller: TransformStreamDefaultController<string>
    ): void
    {
        let listeEnTetes: string[] | undefined = this.enTetes;

        if (!listeEnTetes && !Array.isArray(premiereLigne) && typeof premiereLigne === "object" && premiereLigne !== null)
        {
            listeEnTetes = Object.keys(premiereLigne);
        }

        if (listeEnTetes && listeEnTetes.length > 0)
        {
            const enTetesFormatees = listeEnTetes.map((h) => this.formaterCellule(h));
            controller.enqueue(enTetesFormatees.join(this.separateur) + this.finDeLigne);
        }
    }

    private formaterCellule(valeur: unknown): string
    {
        if (valeur === null || valeur === undefined)
        {
            return "";
        }

        const chaine = String(valeur);
        const necessiteGuillemets = this.guillemetsSystematiques || this.regexGuillemetsRequis.test(chaine);

        if (necessiteGuillemets)
        {
            const echappee = chaine.replaceAll(this.caractereGuillemet, `${this.caractereGuillemet}${this.caractereGuillemet}`);
            return `${this.caractereGuillemet}${echappee}${this.caractereGuillemet}`;
        }

        return chaine;
    }

    private echapperRegex(caractere: string): string
    {
        return caractere.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}

export class CsvWriterStream<T extends RowInput = RowInput> extends TransformStream<T, string>
{
    constructor(options: CsvWriterOptions = {})
    {
        const moteur = new CsvWriterEngine(options);

        super({
            transform(chunk, controller)
            {
                moteur.writeRow(chunk, controller);
            },
        });
    }
}