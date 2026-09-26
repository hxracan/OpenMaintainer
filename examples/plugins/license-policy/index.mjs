export default {
  analyze({ files }) {
    const findings = [];
    if (!files.some((f) => /(^|\/)(LICEN[CS]E|COPYING)(\.[^/]*)?$/i.test(f.path)))
      findings.push({
        id: 'license.missing',
        severity: 'warning',
        title: 'No license file found',
        detail: 'Choose an appropriate license before distributing code; this is not legal advice.',
      });
    for (const file of files.filter((f) => /(^|\/)package.json$/.test(f.path))) {
      try {
        const pkg = JSON.parse(file.content);
        if (!pkg.private && (!pkg.license || pkg.license === 'UNLICENSED'))
          findings.push({
            id: 'license.manifest',
            severity: 'warning',
            title: 'Package license not declared',
            detail: 'Review the license field and distribution intent.',
            path: file.path,
          });
      } catch {
        /* Invalid manifests are handled by the core analyzer. */
      }
    }
    return findings.slice(0, 100);
  },
};
