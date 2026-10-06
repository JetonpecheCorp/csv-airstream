import { CellValidatorFn, CsvReaderOptions } from "./types/CsvOption.js";
import { CsvRowResult } from "./types/CsvRowResult.js";
import { CsvErrorCode, CsvErrorDetail } from "./types/errorCsv.js";

const Etat = {
    DEBUT_CHAMP: 0,
    HORS_GUILLEMETS: 1,
    DANS_GUILLEMETS: 2,
    APRES_GUILLEMETS: 3,
    ECHAPPER_SUIVANT: 4
} as const;

type TypeEtat = (typeof Etat)[keyof typeof Etat];

const SEPARATEURS_PAR_DEFAUT = [",", ";", "\t", "|"] as const;

class CsvParserEngine<T>
{
    private separateur: string;
    private readonly detectionAuto: boolean;
    private readonly separateursCandidats: readonly string[];
    private readonly caractereGuillemet: string;
    private readonly caractereEchappement: string;
    private readonly aEnTete: boolean;
    private readonly rogner: boolean;
    private readonly nombreColonnesStrict: boolean;
    private readonly validerCellule?: CellValidatorFn;
    private readonly headerMapping?: Map<string, string>;
    private readonly targetClass?: new () => any;

    private enReniflage: boolean;
    private tamponReniflage = "";
    private guillemetOuvertReniflage = false;

    private etat: TypeEtat = Etat.DEBUT_CHAMP;
    private champCourant = "";
    private ligneCourante: string[] = [];
    private numeroLigne = 1;
    private nombreColonnesAttendu: number | null = null;
    private enTetes: string[] | null = null;
    private clesCiblesPrecalculees: string[] | null = null;
    private erreurLigne: CsvErrorDetail | null = null;
    private ignorerProchainLF = false;

    private readonly ignorerLignesVides: boolean;
    private readonly commentaire?: string;
    private premierCaractereTraite = false;
    
    // Remplacement du tableau par des Sets pour la validation O(1)
    private readonly indicesRequis = new Set<number>();
    private readonly nomsRequis = new Set<string>();
    
    private readonly indexMapping?: Map<number, string>;
    private readonly indexMappingEntries?: [number, string][];

    private readonly transformers?: Map<string, (val: string) => any>;
    private transformateursPrecalcules: (((val: string) => any) | undefined)[] | null = null;

    constructor(options: CsvReaderOptions)
    {
        this.detectionAuto = options.delimiter === "auto";
        this.separateur = options.delimiter && options.delimiter !== "auto" ? options.delimiter : ",";

        if (this.separateur.length !== 1)
            throw new Error(`Invalid delimiter: "${this.separateur}". Delimiter must be a single character.`);

        this.separateursCandidats = options.delimiterCandidates ?? SEPARATEURS_PAR_DEFAUT;
        this.enReniflage = this.detectionAuto;

        this.caractereGuillemet = options.quoteChar ?? '"';
        this.caractereEchappement = options.escapeChar ?? '"';
        this.aEnTete = options.hasHeader ?? false;
        this.rogner = options.trim ?? false;
        this.nombreColonnesStrict = options.strictColumnCount ?? true;
        this.ignorerLignesVides = options.skipEmptyLines ?? false;
        this.commentaire = options.comment;
        
        // Optimisation : initialisation des Sets
        if (options.requiredColumns) {
            for (const req of options.requiredColumns) {
                if (typeof req === "number") {
                    this.indicesRequis.add(req);
                } else {
                    this.nomsRequis.add(req);
                }
            }
        }
        
        this.headerMapping = options.headerMapping;
        this.indexMapping = options.indexMapping;
        this.indexMappingEntries = options.indexMapping ? Array.from(options.indexMapping.entries()) : undefined;
        this.transformers = options.transformers;
        this.targetClass = options.targetClass;

        if (this.indexMappingEntries && this.transformers) 
        {
            this.transformateursPrecalcules = this.indexMappingEntries.map(([_, propKey]) => 
                this.transformers?.get(propKey)
            );
        }

        this.validerCellule = options.validateCell;
    }

    public parseChunk(
        chunk: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        if (chunk.length === 0) return;

        // Élimine le BOM de début de fichier ET les BOM internes générés par concaténation
        const chunkNettoye = chunk.replace(/\uFEFF/g, "");

        if (this.enReniflage)
        {
            this.reniflerMorceau(chunkNettoye, controller);
            return;
        }

        this.consommerMorceau(chunkNettoye, controller);
    }

    public finish(
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        if (this.enReniflage)
        {
            this.validerSeparateurEtRejouer(controller);
        }

        if (this.ignorerProchainLF)
        {
            this.ignorerProchainLF = false;
        }

        if (this.etat === Etat.DANS_GUILLEMETS || this.etat === Etat.ECHAPPER_SUIVANT)
        {
            controller.enqueue({
                ok: false,
                line: this.numeroLigne,
                error: {
                    code: CsvErrorCode.UNCLOSED_QUOTE,
                    line: this.numeroLigne,
                    columnIndex: this.ligneCourante.length,
                    columnName: this.enTetes ? this.enTetes[this.ligneCourante.length] : undefined,
                    invalidValue: this.champCourant,
                    message: `Unclosed quote detected at end of input on line ${this.numeroLigne}.`,
                },
                raw: this.construireLigneBrute() + (this.champCourant ? this.separateur + this.champCourant : ""),
            });
            return;
        }

        if (this.champCourant.length > 0 || this.ligneCourante.length > 0)
        {
            this.emettreLigne(controller);
        }
    }

    private reniflerMorceau(
        morceau: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        let indexArret = -1;

        for (let i = 0; i < morceau.length; i++)
        {
            const caractere = morceau[i];
            this.tamponReniflage += caractere;

            if (caractere === this.caractereGuillemet)
            {
                this.guillemetOuvertReniflage = !this.guillemetOuvertReniflage;
            }
            else if (!this.guillemetOuvertReniflage)
            {
                if (caractere === "\n" || caractere === "\r" || this.tamponReniflage.length >= 8192)
                {
                    indexArret = i + 1;
                    break;
                }
            }
        }

        if (indexArret !== -1)
        {
            const reste = morceau.slice(indexArret);
            this.validerSeparateurEtRejouer(controller);

            // Ne pas re-consommer si le reste est vide
            if (reste.length > 0)
            {
                this.consommerMorceau(reste, controller);
            }
        }
    }

    private validerSeparateurEtRejouer(
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        this.separateur = this.detecterSeparateurDepuisEchantillon(this.tamponReniflage);
        this.enReniflage = false;

        const texteARejouer = this.tamponReniflage;
        this.tamponReniflage = "";
        
        // On évite de retraiter le BOM si validerSeparateurEtRejouer est appelé au milieu du stream
        this.consommerMorceau(texteARejouer, controller);
    }

    private detecterSeparateurDepuisEchantillon(echantillon: string): string
    {
        const lignes = echantillon.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0).slice(0, 5);

        if (lignes.length === 0)
        {
            return ",";
        }

        let meilleurSeparateur = ",";
        let occurrencesMax = 0;

        for (const candidat of this.separateursCandidats)
        {
            let candidatCoherent = true;
            let frequenceLigne: number | null = null;

            for (const ligne of lignes)
            {
                let compteur = 0;
                let dansGuillemet = false;

                for (let i = 0; i < ligne.length; i++)
                {
                    const caractere = ligne[i];
                    if (caractere === this.caractereGuillemet)
                    {
                        dansGuillemet = !dansGuillemet;
                    }
                    else if (!dansGuillemet && caractere === candidat)
                    {
                        compteur++;
                    }
                }

                if (frequenceLigne === null)
                {
                    frequenceLigne = compteur;
                }
                else if (frequenceLigne !== compteur)
                {
                    candidatCoherent = false;
                    break;
                }
            }

            if (candidatCoherent && frequenceLigne !== null && frequenceLigne > 0)
            {
                if (frequenceLigne > occurrencesMax)
                {
                    occurrencesMax = frequenceLigne;
                    meilleurSeparateur = candidat;
                }
            }
        }

        return meilleurSeparateur;
    }

    private consommerMorceau(
        morceau: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        let debut = 0;

        let indexDebutTexte = debut;

        for (let i = debut; i < morceau.length; i++)
        {
            const caractere = morceau[i];

            // Si on doit ignorer un \n suite à un \r (gestion des retours chariot Windows \r\n)
            if (this.ignorerProchainLF)
            {
                this.ignorerProchainLF = false;
                if (caractere === "\n")
                {
                    indexDebutTexte = i + 1;
                    continue;
                }
            }

            switch (this.etat)
            {
                case Etat.DEBUT_CHAMP:
                    if (caractere === this.caractereGuillemet)
                    {
                        this.etat = Etat.DANS_GUILLEMETS;
                        indexDebutTexte = i + 1; // On ignore le guillemet ouvrant dans le texte
                    }
                    else if (caractere === this.separateur)
                    {
                        this.enregistrerChamp(); // Le champ est vide
                        indexDebutTexte = i + 1; // On avance après le séparateur
                    }
                    else if (caractere === "\r" || caractere === "\n")
                    {
                        if (caractere === "\r") this.ignorerProchainLF = true;
                        this.emettreLigne(controller);
                        indexDebutTexte = i + 1; // On avance après le saut de ligne
                    }
                    else
                    {
                        this.etat = Etat.HORS_GUILLEMETS;
                        // On ne modifie PAS indexDebutTexte car ce caractère fait partie de la valeur
                    }
                    break;

                case Etat.HORS_GUILLEMETS:
                    if (caractere === this.separateur)
                    {
                        this.champCourant += morceau.slice(indexDebutTexte, i);
                        this.enregistrerChamp();
                        this.etat = Etat.DEBUT_CHAMP;
                        indexDebutTexte = i + 1;
                    }
                    else if (caractere === "\r" || caractere === "\n")
                    {
                        this.champCourant += morceau.slice(indexDebutTexte, i);
                        if (caractere === "\r") this.ignorerProchainLF = true;
                        this.emettreLigne(controller);
                        indexDebutTexte = i + 1;
                    }
                    else if (caractere === this.caractereGuillemet)
                    {
                        this.enregistrerErreurSyntaxe(`Unexpected quote inside unquoted field at line ${this.numeroLigne}.`);
                        // Le guillemet sera inclus naturellement lors du prochain slice()
                    }
                    break;

                case Etat.DANS_GUILLEMETS:
                    if (this.caractereEchappement !== this.caractereGuillemet && caractere === this.caractereEchappement)
                    {
                        this.champCourant += morceau.slice(indexDebutTexte, i);
                        this.etat = Etat.ECHAPPER_SUIVANT;
                        indexDebutTexte = i + 1; // On ignore le caractère d'échappement
                    }
                    else if (caractere === this.caractereGuillemet)
                    {
                        this.champCourant += morceau.slice(indexDebutTexte, i);
                        this.etat = Etat.APRES_GUILLEMETS;
                        indexDebutTexte = i + 1; // On ignore le guillemet fermant
                    }
                    break;

                case Etat.APRES_GUILLEMETS:
                    if (this.caractereEchappement === this.caractereGuillemet && caractere === this.caractereGuillemet)
                    {
                        // C'était un double guillemet pour échapper un guillemet (ex: "")
                        this.champCourant += this.caractereGuillemet;
                        this.etat = Etat.DANS_GUILLEMETS;
                        indexDebutTexte = i + 1;
                    }
                    else if (caractere === this.separateur)
                    {
                        this.enregistrerChamp();
                        this.etat = Etat.DEBUT_CHAMP;
                        indexDebutTexte = i + 1;
                    }
                    else if (caractere === "\r" || caractere === "\n")
                    {
                        if (caractere === "\r") this.ignorerProchainLF = true;
                        this.emettreLigne(controller);
                        indexDebutTexte = i + 1;
                    }
                    else
                    {
                        this.enregistrerErreurSyntaxe(`Unexpected character "${caractere}" following closed quote at line ${this.numeroLigne}.`);
                        this.etat = Etat.HORS_GUILLEMETS;
                        indexDebutTexte = i; // Ce caractère inattendu devient le début de la suite du texte
                    }
                    break;

                case Etat.ECHAPPER_SUIVANT:
                    this.champCourant += caractere;
                    this.etat = Etat.DANS_GUILLEMETS;
                    indexDebutTexte = i + 1;
                    break;
            }
        }

        // À la fin du chunk (morceau), on ajoute ce qu'il reste si on était en train de lire du texte
        if (indexDebutTexte < morceau.length)
        {
            if (this.etat === Etat.HORS_GUILLEMETS || this.etat === Etat.DANS_GUILLEMETS)
            {
                this.champCourant += morceau.slice(indexDebutTexte);
            }
        }
    }

    private enregistrerErreurSyntaxe(message: string): void
    {
        if (!this.erreurLigne)
        {
            this.erreurLigne = {
                code: CsvErrorCode.UNEXPECTED_CHAR,
                line: this.numeroLigne,
                columnIndex: this.ligneCourante.length,
                columnName: this.enTetes ? this.enTetes[this.ligneCourante.length] : undefined,
                invalidValue: this.champCourant,
                message,
            };
        }
    }

    private enregistrerChamp(): void
    {
        const valeur = this.rogner && this.etat !== Etat.APRES_GUILLEMETS
            ? this.champCourant.trim()
            : this.champCourant;

        this.ligneCourante.push(valeur);
        this.champCourant = "";
    }

    private emettreLigne(
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        this.enregistrerChamp();

        if (this.commentaire && this.ligneCourante.length > 0)
        {
            const premiereCellule = this.ligneCourante[0];
            if (premiereCellule.startsWith(this.commentaire))
            {
                this.reinitialiserLigne();
                return;
            }
        }

        const estLigneVide =
            this.ligneCourante.length === 0 ||
            this.ligneCourante.every((cellule) => cellule.trim().length === 0);

        if (this.ignorerLignesVides && estLigneVide)
        {
            this.reinitialiserLigne();
            return;
        }

        if (this.erreurLigne)
        {
            controller.enqueue({
                ok: false,
                line: this.numeroLigne,
                error: this.erreurLigne,
                raw: this.construireLigneBrute(),
            });
            this.reinitialiserLigne();
            return;
        }

        if (this.aEnTete && this.enTetes === null)
        {
            this.enTetes = [...this.ligneCourante];
            this.nombreColonnesAttendu = this.enTetes.length;

            if (this.nomsRequis.size > 0)
            {
                for (const req of this.nomsRequis)
                {
                    if (!this.enTetes.includes(req))
                    {
                        controller.enqueue({
                            ok: false,
                            line: this.numeroLigne,
                            error: {
                                code: CsvErrorCode.MISSING_HEADER_COLUMN,
                                line: this.numeroLigne,
                                columnName: req,
                                message: `Required column header "${req}" is missing from the CSV header row.`,
                            },
                            raw: this.construireLigneBrute(),
                        });
                        this.reinitialiserLigne();
                        return;
                    }
                }
            }

            this.clesCiblesPrecalculees = new Array(this.enTetes.length);
            this.transformateursPrecalcules = new Array(this.enTetes.length);

            for (let i = 0; i < this.enTetes.length; i++)
            {
                const headerBrut = this.enTetes[i];
                const propKey = this.headerMapping?.get(headerBrut) ?? this.indexMapping?.get(i) ?? headerBrut;

                this.clesCiblesPrecalculees[i] = propKey;
                this.transformateursPrecalcules[i] = this.transformers?.get(propKey);
            }

            this.reinitialiserLigne();
            return;
        }

        if (this.nombreColonnesStrict)
        {
            if (this.nombreColonnesAttendu === null)
            {
                this.nombreColonnesAttendu = this.ligneCourante.length;
            }
            else if (this.ligneCourante.length !== this.nombreColonnesAttendu)
            {
                controller.enqueue({
                    ok: false,
                    line: this.numeroLigne,
                    error: {
                        code: CsvErrorCode.COLUMN_COUNT_MISMATCH,
                        line: this.numeroLigne,
                        message: `Expected ${this.nombreColonnesAttendu} columns, found ${this.ligneCourante.length}.`,
                    },
                    raw: this.construireLigneBrute(),
                });
                this.reinitialiserLigne();
                return;
            }
        }

        if (this.indicesRequis.size > 0 || this.nomsRequis.size > 0 || this.validerCellule)
        {
            for (let i = 0; i < this.ligneCourante.length; i++)
            {
                const valeur = this.ligneCourante[i];
                const nomColonne = this.enTetes ? this.enTetes[i] : undefined;

                const estRequise = this.indicesRequis.has(i) || (nomColonne !== undefined && this.nomsRequis.has(nomColonne));

                if (estRequise && valeur.trim().length === 0)
                {
                    controller.enqueue({
                        ok: false,
                        line: this.numeroLigne,
                        error: {
                            code: CsvErrorCode.MISSING_REQUIRED_COLUMN,
                            line: this.numeroLigne,
                            columnIndex: i,
                            columnName: nomColonne,
                            invalidValue: valeur,
                            message: `Missing required value for column ${nomColonne ? `"${nomColonne}"` : i} on line ${this.numeroLigne}.`,
                        },
                        raw: this.construireLigneBrute(),
                    });
                    this.reinitialiserLigne();
                    return;
                }

                if (this.validerCellule)
                {
                    const verification = this.validerCellule(valeur, {
                        line: this.numeroLigne,
                        columnIndex: i,
                        columnName: nomColonne,
                    });

                    if (verification !== true)
                    {
                        const codePersonnalise = typeof verification === "string" ? verification : CsvErrorCode.INVALID_COLUMN_VALUE;
                        controller.enqueue({
                            ok: false,
                            line: this.numeroLigne,
                            error: {
                                code: codePersonnalise,
                                line: this.numeroLigne,
                                columnIndex: i,
                                columnName: nomColonne,
                                invalidValue: valeur,
                                message: `Validation failed for column ${nomColonne ?? i} with value "${valeur}".`,
                            },
                            raw: this.construireLigneBrute(),
                        });
                        this.reinitialiserLigne();
                        return;
                    }
                }
            }
        }

        if (this.aEnTete && this.clesCiblesPrecalculees)
        {
            const nbCols = this.clesCiblesPrecalculees.length;
            const objet: Record<string, any> = this.targetClass ? new this.targetClass() : {};

            for (let i = 0; i < nbCols; i++)
            {
                const val = this.ligneCourante[i] ?? "";
                const fn = this.transformateursPrecalcules![i];
                objet[this.clesCiblesPrecalculees[i]] = fn ? fn(val) : val;
            }

            controller.enqueue({
                ok: true,
                line: this.numeroLigne,
                data: objet as unknown as T,
            });
        }
        else if (this.indexMappingEntries && this.indexMappingEntries.length > 0)
        {
            const objet: Record<string, any> = this.targetClass ? new this.targetClass() : {};
            for (let i = 0; i < this.indexMappingEntries.length; i++)
            {
                const [colIndex, propKey] = this.indexMappingEntries[i];
                const val = this.ligneCourante[colIndex] ?? "";
                const fn = this.transformateursPrecalcules ? this.transformateursPrecalcules[i] : undefined;
                objet[propKey] = fn ? fn(val) : val;
            }
            controller.enqueue({
                ok: true,
                line: this.numeroLigne,
                data: objet as unknown as T,
            });
        }
        else
        {
            controller.enqueue({
                ok: true,
                line: this.numeroLigne,
                data: this.ligneCourante as unknown as T,
            });
        }

        this.reinitialiserLigne();
    }

    private reinitialiserLigne(): void
    {
        this.ligneCourante = [];
        this.numeroLigne++;
        this.erreurLigne = null;
        this.etat = Etat.DEBUT_CHAMP;
    }

    private construireLigneBrute(): string
    {
        return this.ligneCourante.join(this.separateur);
    }
}

export class CsvReaderStream<T = string[]> extends TransformStream<string, CsvRowResult<T>>
{
    constructor(options: CsvReaderOptions = {})
    {
        const moteur = new CsvParserEngine<T>(options);

        super({
            transform(chunk, controller)
            {
                moteur.parseChunk(chunk, controller);
            },
            flush(controller)
            {
                moteur.finish(controller);
            },
        });
    }
}