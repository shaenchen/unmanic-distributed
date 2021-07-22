const Hapi = require("@hapi/hapi");

let logger;

const init = async (loggerInstance) => {
  logger = loggerInstance.child({ source: "server" });
  const server = Hapi.server({
    port: 8080,
    host: "0.0.0.0",
  });

  server.events.on("response", function (request) {
    logger.debug("response", {
      remoteAddress: request.info.remoteAddress,
      method: request.method,
      path: request.path,
      status: request.response.statusCode,
    });
  });

  await server.start();
  logger.info(`Listening on ${server.info.uri}`);
  return server;
};

module.exports = {
  init,
};
