import { CellValidator, CsvReaderOptions } from "./types/CsvOption.js";
import { CsvRowResult } from "./types/CsvRowResult.js";
import { CsvErrorCode, CsvErrorDetail } from "./types/errorCsv.js";

const Etat = {
    DEBUT_CHAMP: 0,
    HORS_GUILLEMETS: 1,
    DANS_GUILLEMETS: 2,
    APRES_GUILLEMETS: 3,
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
    private readonly validerCellule?: CellValidator;

    private enReniflage: boolean;
    private tamponReniflage = "";
    private guillemetOuvertReniflage = false;

    private etat: TypeEtat = Etat.DEBUT_CHAMP;
    private champCourant = "";
    private ligneCourante: string[] = [];
    private numeroLigne = 1;
    private nombreColonnesAttendu: number | null = null;
    private enTetes: string[] | null = null;
    private erreurLigne: CsvErrorDetail | null = null;
    private dernierCaractere = "";

    private readonly ignorerLignesVides: boolean;
    private readonly commentaire?: string;
    private premierCaractereTraite = false;

    constructor(options: CsvReaderOptions)
    {
        this.detectionAuto = options.delimiter === "auto";
        this.separateur = options.delimiter && options.delimiter !== "auto" ? options.delimiter : ",";
        this.separateursCandidats = options.delimiterCandidates ?? SEPARATEURS_PAR_DEFAUT;
        this.enReniflage = this.detectionAuto;

        this.caractereGuillemet = options.quoteChar ?? '"';
        this.caractereEchappement = options.escapeChar ?? '"';
        this.aEnTete = options.hasHeader ?? false;
        this.rogner = options.trim ?? false;
        this.nombreColonnesStrict = options.strictColumnCount ?? true;
        this.ignorerLignesVides = options.skipEmptyLines ?? false;
        this.commentaire = options.comment;

        this.validerCellule = options.validateCell;
    }

    public parseChunk(
        chunk: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        if (this.enReniflage)
        {
            this.reniflerMorceau(chunk, controller);
            return;
        }

        this.consommerMorceau(chunk, controller);
    }

    public finish(
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        if (this.enReniflage)
        {
            this.validerSeparateurEtRejouer(controller);
        }

        if (this.etat === Etat.DANS_GUILLEMETS)
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
        if (!this.premierCaractereTraite)
        {
            this.premierCaractereTraite = true;
            if (morceau.charCodeAt(0) === 0xFEFF)
            {
                morceau = morceau.slice(1);
            }
        }

        let indexCoupure = -1;

        for (let i = 0; i < morceau.length; i++)
        {
            const caractere = morceau[i];
            this.tamponReniflage += caractere;

            if (caractere === this.caractereGuillemet)
            {
                this.guillemetOuvertReniflage = !this.guillemetOuvertReniflage;
            }
            else if (!this.guillemetOuvertReniflage && (caractere === "\n" || caractere === "\r"))
            {
                indexCoupure = i + 1;
                break;
            }
        }

        if (indexCoupure !== -1 || this.tamponReniflage.length >= 4096)
        {
            const reste = indexCoupure !== -1 
                ? morceau.slice(indexCoupure) 
                : morceau.slice(this.tamponReniflage.length);

            this.validerSeparateurEtRejouer(controller);

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

        if (!this.premierCaractereTraite)
        {
            this.premierCaractereTraite = true;
            if (morceau.charCodeAt(0) === 0xFEFF)
            {
                debut = 1;
            }
        }

        for (let i = debut; i < morceau.length; i++)
        {
            const caractere = morceau[i];

            if (this.dernierCaractere === "\r" && caractere === "\n")
            {
                this.dernierCaractere = caractere;
                continue;
            }
            this.dernierCaractere = caractere;

            this.traiterCaractere(caractere, controller);
        }
    }

    private traiterCaractere(
        caractere: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        switch (this.etat)
        {
            case Etat.DEBUT_CHAMP:
                this.gererDebutChamp(caractere, controller);
                break;

            case Etat.HORS_GUILLEMETS:
                this.gererHorsGuillemets(caractere, controller);
                break;

            case Etat.DANS_GUILLEMETS:
                this.gererDansGuillemets(caractere);
                break;

            case Etat.APRES_GUILLEMETS:
                this.gererApresGuillemets(caractere, controller);
                break;
        }
    }

    private gererDebutChamp(
        caractere: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        if (caractere === this.caractereGuillemet)
        {
            this.etat = Etat.DANS_GUILLEMETS;
        }
        else if (caractere === this.separateur)
        {
            this.enregistrerChamp();
        }
        else if (caractere === "\r" || caractere === "\n")
        {
            this.emettreLigne(controller);
        }
        else
        {
            this.champCourant += caractere;
            this.etat = Etat.HORS_GUILLEMETS;
        }
    }

    private gererHorsGuillemets(
        caractere: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        if (caractere === this.separateur)
        {
            this.enregistrerChamp();
            this.etat = Etat.DEBUT_CHAMP;
        } 
        else if (caractere === "\r" || caractere === "\n")
        {
            this.emettreLigne(controller);
        } 
        else if (caractere === this.caractereGuillemet)
        {
            this.enregistrerErreurSyntaxe(`Unexpected quote inside unquoted field at line ${this.numeroLigne}.`);
            this.champCourant += caractere;
        } 
        else
        {
            this.champCourant += caractere;
        }
    }

    private gererDansGuillemets(caractere: string): void
    {
        if (caractere === this.caractereEchappement && this.caractereEchappement === this.caractereGuillemet)
        {
            this.etat = Etat.APRES_GUILLEMETS;
        } 
        else
        {
            this.champCourant += caractere;
        }
    }

    private gererApresGuillemets(
        caractere: string,
        controller: TransformStreamDefaultController<CsvRowResult<T>>
    ): void
    {
        if (caractere === this.caractereGuillemet)
        {
            this.champCourant += this.caractereGuillemet;
            this.etat = Etat.DANS_GUILLEMETS;
        } 
        else if (caractere === this.separateur)
        {
            this.enregistrerChamp();
            this.etat = Etat.DEBUT_CHAMP;
        } 
        else if (caractere === "\r" || caractere === "\n")
        {
            this.emettreLigne(controller);
        } 
        else
        {
            this.enregistrerErreurSyntaxe(`Unexpected character "${caractere}" following closed quote at line ${this.numeroLigne}.`);
            this.champCourant += caractere;
            this.etat = Etat.HORS_GUILLEMETS;
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

        if (this.validerCellule)
        {
            for (let i = 0; i < this.ligneCourante.length; i++)
            {
                const valeur = this.ligneCourante[i];
                const nomColonne = this.enTetes ? this.enTetes[i] : undefined;
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

        if (this.aEnTete && this.enTetes)
        {
            const objet: Record<string, string> = {};
            for (let i = 0; i < this.enTetes.length; i++)
            {
                objet[this.enTetes[i]] = this.ligneCourante[i] ?? "";
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

export class CsvReaderStream<T = string[]> extends TransformStream<
    string,
    CsvRowResult<T>
>
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