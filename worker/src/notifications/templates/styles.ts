// Estilos en línea de los correos (spec 0042): la paleta y las formas de la marca Boka Verde.
// Los clientes de correo no cargan hojas de estilo ni fuentes propias de forma confiable, así que
// todo va en atributos `style` y los títulos usan Georgia como serif de reemplazo de Gloock.

export const EmailColor = {
  bone: '#f4f1de',
  card: '#fffdf6',
  night: '#0d1f17',
  forest: '#1b3b2b',
  muted: '#43564b',
  line: '#e3dec3',
} as const;

const SERIF = "Georgia,'Times New Roman',serif";

export const EmailStyle = {
  h1: `margin:0 0 16px;font-family:${SERIF};font-size:26px;line-height:1.15;font-weight:400;letter-spacing:-0.01em;color:${EmailColor.night};`,
  detailTable: `background:${EmailColor.bone};border-radius:14px;margin:0 0 24px;`,
  button: `display:inline-block;background:${EmailColor.forest};color:${EmailColor.bone};padding:14px 28px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;`,
  link: `color:${EmailColor.forest};text-decoration:underline;`,
  muted: EmailColor.muted,
} as const;
