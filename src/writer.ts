import { CsvWriterOptions } from "./types/CsvOption.js";

export type RowInput = unknown[] | object;

class CsvWriterEngine
{
    private readonly separateur: string;
    private readonly caractereGuillemet: string;
    private readonly finDeLigne: string;
    private readonly guillemetsSystematiques: boolean;
    private readonly writeBom: boolean;
    private readonly enTetes?: string[];
    private readonly clesProprietes?: string[];
    private readonly regexGuillemetsRequis: RegExp;
    private readonly regexGuillemetGlobal: RegExp;
    private readonly guillemetDouble: string;
    private enTeteEcrite = false;
    private premierMorceauEmis = false;
    private clesEnregistrementCache?: string[];

    private tampon: string[] = [];
    private tailleTamponCourante = 0;
    private readonly tailleMaxTamponCaracteres = 65536;

    constructor(options: CsvWriterOptions)
    {
        this.separateur = options.delimiter ?? ",";
        this.caractereGuillemet = options.quoteChar ?? '"';
        this.finDeLigne = options.lineTerminator ?? "\r\n";
        this.guillemetsSystematiques = options.alwaysQuote ?? false;
        this.writeBom = options.writeBom ?? false;
        this.enTetes = options.headers;
        this.clesProprietes = options.propertyKeys;

        const sepEscaped = this.echapperRegex(this.separateur);
        const quoteEscaped = this.echapperRegex(this.caractereGuillemet);
        
        // Regex corrigée pour les délimiteurs multi-caractères
        this.regexGuillemetsRequis = new RegExp(`(?:${sepEscaped}|${quoteEscaped}|\\r|\\n)`);
        this.regexGuillemetGlobal = new RegExp(quoteEscaped, "g");
        this.guillemetDouble = `${this.caractereGuillemet}${this.caractereGuillemet}`;
    }

    public writeRow(
        ligne: RowInput,
        controller: TransformStreamDefaultController<string>
    ): void
    {
        const cellules: string[] = [];

        // Gestion de l'entête
        if (!this.enTeteEcrite)
        {
            this.enTeteEcrite = true;
            let listeEnTetes = this.enTetes;

            if (!listeEnTetes && !Array.isArray(ligne) && typeof ligne === "object" && ligne !== null)
            {
                listeEnTetes = Object.keys(ligne);
                this.clesEnregistrementCache = listeEnTetes; // Mise en cache immédiate
            }

            if (listeEnTetes && listeEnTetes.length > 0)
            {
                const prefixeEntete = (!this.premierMorceauEmis && this.writeBom) ? "\uFEFF" : "";
                const enTetesFormatees = listeEnTetes.map((h) => this.formaterCellule(h));
                
                const ligneEntete = prefixeEntete + enTetesFormatees.join(this.separateur) + this.finDeLigne;
                this.tampon.push(ligneEntete);
                this.tailleTamponCourante += ligneEntete.length;
                this.premierMorceauEmis = true;
            }
        }

        // Remplissage des cellules
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
            
            // On utilise le cache si disponible, ce qui évite un Object.keys() par ligne
            if (!this.clesEnregistrementCache)
                this.clesEnregistrementCache = this.clesProprietes ?? this.enTetes ?? Object.keys(enregistrement);

            const cles = this.clesEnregistrementCache;
            
            for (let i = 0; i < cles.length; i++)
                cellules.push(this.formaterCellule(enregistrement[cles[i]]));
        }

        const debutLigne = (!this.premierMorceauEmis && this.writeBom) ? "\uFEFF" : "";
        this.premierMorceauEmis = true;
        
        const ligneComplete = debutLigne + cellules.join(this.separateur) + this.finDeLigne;
        
        // On pousse directement la chaîne dans le tableau, sans += qui copie la mémoire
        this.tampon.push(ligneComplete);
        this.tailleTamponCourante += ligneComplete.length;

        if (this.tailleTamponCourante >= this.tailleMaxTamponCaracteres)
            this.flush(controller);
    }

    public flush(controller: TransformStreamDefaultController<string>): void
    {
        if (this.tampon.length > 0)
        {
            controller.enqueue(this.tampon.join(""));
            this.tampon = [];
            this.tailleTamponCourante = 0;
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
            const echappee = chaine.replace(this.regexGuillemetGlobal, this.guillemetDouble);
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
            flush(controller)
            {
                // Garantit que les dernières lignes sont émises avant la fermeture
                moteur.flush(controller);
            },
        });
    }
}