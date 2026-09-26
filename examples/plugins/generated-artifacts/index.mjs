export default {
  analyze({ files }) {
    return files
      .filter((f) => /(^|\/)node_modules\/|\.(exe|dll|zip|tar|gz|wasm)$/i.test(f.path))
      .slice(0, 100)
      .map((f) => ({
        id: 'artifacts.review',
        severity: 'info',
        title: 'Review binary or generated artifact',
        detail:
          'Check provenance and whether this artifact belongs in source control. File size and content are not inspected.',
        path: f.path,
      }));
  },
};
