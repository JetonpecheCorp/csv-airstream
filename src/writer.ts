import { CsvWriterOptions } from "./types/CsvOption.js";

type EntreeLigne = unknown[] | Record<string, unknown>;

class CsvWriterEngine
{
    private readonly separateur: string;
    private readonly caractereGuillemet: string;
    private readonly finDeLigne: string;
    private readonly guillemetsSystematiques: boolean;
    private readonly enTetes?: string[];
    private readonly regexGuillemetsRequis: RegExp;
    private enTeteEcrite = false;

    constructor(options: CsvWriterOptions)
    {
        this.separateur = options.delimiter ?? ",";
        this.caractereGuillemet = options.quoteChar ?? '"';
        this.finDeLigne = options.lineTerminator ?? "\r\n";
        this.guillemetsSystematiques = options.alwaysQuote ?? false;
        this.enTetes = options.headers;

        const separateurEchappe = this.echapperRegex(this.separateur);
        const guillemetEchappe = this.echapperRegex(this.caractereGuillemet);
        this.regexGuillemetsRequis = new RegExp(`[${separateurEchappe}${guillemetEchappe}\\r\\n]`);
    }

    public writeRow(
        ligne: EntreeLigne,
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
            const cles = this.enTetes ?? Object.keys(ligne);
            for (let i = 0; i < cles.length; i++)
            {
                const valeur = (ligne as Record<string, unknown>)[cles[i]];
                cellules.push(this.formaterCellule(valeur));
            }
        }

        controller.enqueue(cellules.join(this.separateur) + this.finDeLigne);
    }

    private ecrireEnTetesSiBesoin(
        premiereLigne: EntreeLigne,
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

export class CsvWriterStream<T extends EntreeLigne = EntreeLigne> extends TransformStream<T, string>
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