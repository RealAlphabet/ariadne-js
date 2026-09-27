# Ariadne

Suivre le fil d’une variable dans un labyrinthe de JavaScript.

`@animeo/ariadne` extrait le calcul d’une variable depuis du JavaScript ou les
scripts classiques d’une page HTML. Acorn construit l’AST, `eslint-scope` résout
les identifiants par portée, et `parse5` lit le HTML. L’analyse ne lance aucun
code fourni et ne télécharge aucun script.

## Utilisation

Depuis la racine du dépôt :

```sh
corepack pnpm@10.12.1 --filter @animeo/ariadne install --ignore-scripts

node packages/ariadne/src/cli.js \
  packages/ariadne/fixtures/voe/loader.js \
  --variable _0x1b9c97 \
  --near 'var _0x1b9c97 = _0x469900' \
  --output /tmp/voe-lifted.js
```

Pour une page HTML et un script externe déjà sauvegardé :

```sh
node packages/ariadne/src/cli.js \
  packages/ariadne/fixtures/voe/page.html \
  --variable _0x1b9c97 \
  --script '/js/loader.a40897e.js=packages/ariadne/fixtures/voe/loader.js' \
  --output /tmp/voe-lifted.js
```

`--near` est une expression régulière. Parmi les déclarations et affectations du
même nom, Ariadne choisit celle la plus proche d’une occurrence du motif. Une
égalité, un motif absent ou plusieurs candidats sans motif provoquent une erreur.
La valeur observée est celle **immédiatement après l’écriture sélectionnée**.
Les écritures suivantes ne sont pas exécutées.

Sans `--output`, le JavaScript est écrit sur stdout. Les métadonnées (position,
références externes et scripts manquants) sont écrites sur stderr.

## API

### Nettoyage du fichier extrait

`examples/voe-lifted-clean.js` est généré à partir de `examples/voe-lifted.js`
avec **webcrack puis Terser**. Pour le régénérer :

```sh
corepack pnpm@10.12.1 --filter @animeo/ariadne clean:voe
```

Webcrack reconnaît la table de chaînes, sa rotation et ses décodeurs. Il remplace
les appels par leurs résultats puis retire ces fonctions devenues inutiles.
Les fragments qu’il sélectionne sont évalués dans un interpréteur QuickJS neuf,
sans fonctions hôtes, DOM, réseau ni chargeur de modules. Chaque évaluation est
limitée à 2 secondes, 32 Mio de mémoire et 512 Kio de pile. Les mutations de cet
état temporaire ne sont pas appliquées à l’environnement Node.

Cette isolation protège l’hôte ; elle ne prouve pas qu’une mutation quelconque
est supprimable. La transformation repose sur les motifs reconnus par webcrack.
Les données de la page restent des entrées à l’exécution du fichier produit.
L’extraction `liftScript`/`liftHtml` reste entièrement statique ; cette évaluation
partielle concerne seulement la commande de nettoyage.

Trois passes Terser simplifient ensuite les expressions et retirent le code
inutilisé. La sortie reste indentée, sans renommage des identifiants. L’option
`compress.expression` préserve la valeur renvoyée par l’expression extraite.
Les tests comparent le résultat original et nettoyé sur la configuration connue
et plusieurs entrées supplémentaires. Les noms métier ne sont pas reconstitués.

Le package `ben-sb/obfuscator-io-deobfuscator` a aussi été essayé sur cette fixture :
sa version 1.0.6 signale `Unknown reference to string array function` et conserve
la table. Webcrack 2.16.0 reconnaît cette variante sans adaptation du source.

### Extraction

```js
import { liftScript, liftHtml } from '@animeo/ariadne';

const { code, externals, target, retained } = liftScript(source, {
  variable: '_0x1b9c97',
  near: /var _0x1b9c97 = _0x469900/,
});

const result = liftHtml(html, {
  variable: '_0x1b9c97',
  scripts: { '/js/loader.a40897e.js': loaderSource },
});
```

`code` est une expression JavaScript immédiatement invoquée qui renvoie la valeur
cible. Elle peut donc renvoyer un objet, un primitif ou une fonction, sans imposer
de sérialisation ni modifier une variable globale. Exemple de forme produite :

```js
(() => {
  function decode(value) { return JSON.parse(atob(value)); }
  const result = decode(payload);
  return result;
})();
```

`externals` contient tous les identifiants non résolus lexicalement, y compris
les natifs. Ils restent tels quels dans le code émis : `document`, `atob` ou une
fonction fournie par un autre script doivent exister dans l’environnement
d’exécution. Le HTML d’entrée sert à trouver le code ; il n’est pas transformé en
DOM embarqué dans le fichier produit. Pour VOE, exécuter le résultat avec le
document correspondant à la configuration encodée.

`retained` contient les plages du code source conservées. `target` indique le nom,
les offsets et la position (ligne à partir de 1, colonne à partir de 0). Pour HTML,
ces positions concernent la concaténation des scripts fournis, dans l’ordre du
document, avec `\n;\n` entre chaque script. `missingScripts` liste les attributs
`src` non fournis ; leurs symboles peuvent rester externes. Les clés de `scripts`
correspondent exactement aux attributs `src`, sans résolution d’URL.

## Algorithme et contrat

1. Identifier l’écriture cible et son chemin de portées lexicales.
2. Découper les déclarations multiples et les séquences d’expressions pour
   pouvoir retirer leurs voisins indépendants.
3. Suivre les références jusqu’aux déclarations accessibles, récursivement.
   Conserver les fonctions nécessaires en entier, avec leurs portées internes.
4. Inclure les écritures précédentes, leurs blocs de contrôle, et les
   initialisations susceptibles de modifier une dépendance : affectations,
   appels de méthodes, passage de dépendances en arguments, IIFE et fonctions
   d’initialisation directement résolubles. Suivre les alias directs.
5. Répéter jusqu’à stabilisation, puis émettre les unités dans l’ordre source,
   avec des fermetures imbriquées pour préserver les masquages et les directives.

Hypothèse centrale : les natifs JavaScript et les références externes ne sont pas
patchés au cours du script. Les déclarations locales restent prioritaires sur les
homonymes natifs ; un paramètre local n’est jamais inventé comme dépendance globale.

Cette première version est un **extracteur statique ciblé**, pas un solveur de
tous les effets possibles d’un programme. Elle conserve des unités complètes :
une fonction ou un `try` utile peut aussi contenir des opérations inutiles. Elle
ne garantit donc pas un minimum mathématique de code. Elle ne simplifie pas les
noms obfusqués ni les tables de chaînes.

Limites à respecter :

- Sources JavaScript classiques ES2022. Les modules sont refusés. Pour HTML,
  l’ordre des scripts fournis doit correspondre à leur ordre d’exécution ; les
  chargements asynchrones et l’insertion dynamique ne sont pas modélisés.
- La cible doit être une déclaration simple ou une affectation autonome dans un
  programme ou un corps de fonction. Les cibles dans une branche, une boucle,
  un bloc lexical, une fonction async ou un générateur sont refusées.
- Les corps englobants sont extraits sans reproduire l’appel du bundle ou du
  callback. Leurs dépendances doivent être initialisées avant leur emplacement
  dans le source. Les arguments d’invocation requis, `this` et `arguments` issus
  d’un contexte supprimé sont refusés. Un callback exécuté plus tard avec un
  état changé nécessite une analyse supplémentaire.
- Les dépendances retenues contenant `with` ou un appel direct à `eval` sont
  refusées. Le code dynamique, les proxies/getters à effets de bord, les alias
  stockés dans des objets, les mutations indirectes via appels non résolus et les
  relations `window.x` ↔ variable globale ne sont pas modélisés.
- L’analyse ne reproduit pas les effets indépendants du calcul, par exemple un
  appel externe qui interrompt le programme avant la cible. Elle suppose que le
  point cible est atteint. Une sortie extraite reste du code tiers lorsqu’on
  décide de l’exécuter ; l’extraction n’est pas une sandbox.

## Fixture VOE et vérification

`fixtures/voe/loader.js` est le fichier fourni à la racine du dépôt, déplacé sans
modification. `page.html` et `expected.json` forment un exemple synthétique figé,
sans URL vidéo réelle. Son payload a été construit indépendamment du slicer par
inversion des étapes du décodeur observé : JSON → base64 → inversion → décalage
des caractères de +3 → base64 → insertion de marqueurs `^^` → ROT13.

Les tests vérifient le résultat décodé attendu, la rotation de table du loader,
les portées, cycles, affectations, initialisations, références externes, ambiguïtés,
HTML et CLI. Les exécutions de test utilisent uniquement les fixtures connues.

```sh
corepack pnpm@10.12.1 --filter @animeo/ariadne test
```

Références : [Acorn](https://github.com/acornjs/acorn),
[eslint-scope](https://github.com/eslint/js/tree/main/packages/eslint-scope),
[parse5](https://parse5.js.org/).
Nettoyage : [webcrack](https://github.com/j4k0xb/webcrack),
[QuickJS](https://github.com/justjake/quickjs-emscripten),
[Terser](https://terser.org/docs/options/).
