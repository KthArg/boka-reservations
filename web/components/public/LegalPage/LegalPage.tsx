import { Link } from '@/i18n/navigation';
import type { LegalBlock, LegalDocument } from '@/content/legal/types';
import { PrintButton } from './PrintButton';
import styles from './LegalPage.module.css';

type Labels = {
  back: string;
  print: string;
  version: string;
};

type Props = {
  document: LegalDocument;
  labels: Labels;
};

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'p') return <p className={styles.paragraph}>{block.text}</p>;
  if (block.kind === 'ul') {
    return (
      <ul className={styles.list}>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {block.head.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td key={`${row[0]}-${index}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Página de un texto legal (spec 0034): muestra una versión publicada, con anclas estables por
 * sección (el pie del sitio enlaza `#quejas`) y un botón para imprimirla o guardarla en PDF, que
 * es lo que promete la cláusula 2 de los términos.
 */
export function LegalPage({ document, labels }: Props) {
  return (
    <article className={styles.page}>
      <h1 className={styles.title}>{document.title}</h1>
      <div className={styles.meta}>
        <span>{labels.version}</span>
        <PrintButton label={labels.print} />
      </div>
      {document.intro.map((block, index) => (
        <Block key={`intro-${index}`} block={block} />
      ))}
      {document.sections.map((section) => (
        <section key={section.id} id={section.id} className={styles.section}>
          <h2 className={styles.sectionTitle}>{section.title}</h2>
          {section.blocks.map((block, index) => (
            <Block key={`${section.id}-${index}`} block={block} />
          ))}
        </section>
      ))}
      <Link href="/" className={styles.back}>
        {labels.back}
      </Link>
    </article>
  );
}

/** Lo que se ve mientras falten los datos del operador: nunca un texto con huecos. */
export function LegalPageUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <article className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.paragraph}>{message}</p>
    </article>
  );
}
