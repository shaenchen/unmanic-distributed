const winston = require("winston");
require("winston-daily-rotate-file");
const util = require("util");
const server = require("./server");
const worker = require("./worker");

const devmode = process.env.NODE_ENV == "DEV";

let mongoClient;
let logger;

const stripSymbols = (obj) =>
  Object.entries(obj).reduce(
    (acc, [k, v]) => (typeof k == "symbol" ? acc : ((acc[k] = v), acc)),
    {}
  );

const baseLogger = winston.createLogger({
  level: devmode ? "silly" : "verbose",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.DailyRotateFile({
      filename: "log/application-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
  ],
});

baseLogger.add(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf((info) => {
        const { level, message, timestamp, source, ...remaining } = info;
        return `${timestamp} [${level}|${source}] : ${message}${
          Object.keys(remaining).length < 1
            ? ""
            : `\n${util.format(stripSymbols(remaining))}`
        }`;
      })
    ),
    level: devmode ? "debug" : "info",
  })
);

logger = baseLogger.child({ source: "main" });

process.on("unhandledRejection", (err) => {
  logger.error("Fatal unhandled error", err);
  if (mongoClient) mongoClient.close();
  process.exit(1);
});

const init = async () => {
  let serverInstance = await server.init(baseLogger);
  worker.init(baseLogger, serverInstance);
};

init();
