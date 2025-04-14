function deepMerge(target, source) {
  const output = { ...target };
  for (const key in source) {
    if (
      source[key] instanceof Object &&
      key in target &&
      target[key] instanceof Object &&
      typeof source[key] !== "undefined"
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

module.exports = {
  deepMerge,
};
