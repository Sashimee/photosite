import { checkCatalogs, type CatalogIssue } from '../catalog.js';
import { CATALOGS } from '../index.js';

function format(issue: CatalogIssue): string {
  return `  [${issue.kind}] ${issue.locale} ${issue.key}: ${issue.detail}`;
}

const strict = process.argv.includes('--strict');
const { en, ...translations } = CATALOGS;
const { errors, warnings } = checkCatalogs(en, translations, { strict });

if (warnings.length > 0) {
  console.warn(`i18n check: ${String(warnings.length)} warning(s)`);
  for (const warning of warnings) console.warn(format(warning));
}

if (errors.length > 0) {
  console.error(`i18n check failed: ${String(errors.length)} error(s)`);
  for (const error of errors) console.error(format(error));
  console.error('Fix the catalogs in packages/i18n/messages; en is the source of truth.');
  process.exit(1);
}

console.log(`i18n check passed${strict ? ' (strict)' : ''}`);
