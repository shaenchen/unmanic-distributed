const sleep = (ms, logger) => {
  if (logger) logger.debug(`Sleeping for ${ms}ms`);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

module.exports = {
  sleep,
};
