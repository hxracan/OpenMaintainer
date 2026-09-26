export default {
  analyze({ files }) {
    return files.some(
      (f) => /(^|\/)(CHANGELOG|CHANGES)(\.[^/]*)?$/i.test(f.path) || f.path.startsWith('.changeset/'),
    )
      ? []
      : [
          {
            id: 'changelog.missing',
            severity: 'info',
            title: 'No changelog convention found',
            detail: 'Consider release notes or Changesets so users can understand version changes.',
          },
        ];
  },
  condition(input) {
    return Array.isArray(input.paths) && input.paths.some((p) => /^CHANGELOG|^\.changeset\//i.test(p));
  },
  command(input) {
    return {
      hint: 'Use conventional commits or Changesets, then prepare a draft with openmaintainer release prepare.',
      input,
    };
  },
};
