const axios = require("axios");
let config = require("./config");
const { sleep } = require("./utils");
const fs = require("fs");

let logger;

let seenFiles = {};
const startTime = Date.now();

const check_instance = async (obj) => {
  const result = await axios.get(obj.url + "/?ajax=workersInfo");
  for (let i = 0; i < result.data.length; i++) {
    if (
      !result.data[i].idle &&
      seenFiles[obj.url].indexOf(result.data[i].current_file) === -1
    ) {
      seenFiles[obj.url].push(result.data[i].current_file);
    }
  }
  return {
    running: result.data.filter((o) => !o.idle).length,
    max: result.data.length,
    processes: result.data.map((o) => {
      const p_obj = {
        status: "idle",
        file: "",
        percent: 0,
        elapsed: 0,
        remaining: 0,
      };
      if (!o.idle) {
        p_obj.status = "active";
        p_obj.file = o.current_file;
        if (o.progress) {
          p_obj.elapsed = o.progress.elapsed ? o.progress.elapsed * 1 : 0;
          if (o.progress.duration > 0) {
            p_obj.percent = o.progress.time / o.progress.duration;
            if (p_obj.percent > 0) {
              p_obj.remaining =
                (1 - p_obj.percent) * (p_obj.elapsed / p_obj.percent);
            }
          }
        }
      }
      return p_obj;
    }),
  };
};

const getQueue = async (instance) => {
  const result = await axios.post(instance.url + "/api/v1/pending/list", {
    search: {
      value: "",
    },
    length: 10,
  });
  return result.data.data;
};

const addByPath = async (path, instance) => {
  logger.info(`Adding ${path} to ${instance.url}`);
  const result = await axios.post(instance.url + "/api/v1/pending/add/", {
    path,
  });
  return result.data.success;
};

const removeFromQueue = async (item, instance) => {
  logger.info(`Removing ${item.abspath} from ${instance.url}`);
  const result = await axios.post(instance.url + "/api/v1/pending/list", {
    customActionName: "remove-from-task-list",
    id: [item.id],
    search: {
      value: "",
    },
    length: 1,
  });
  return Object.keys(result.data).indexOf("success") > -1
    ? result.data.success
    : true;
};

const moveToQueue = async (secondary) => {
  const mainQueue = await getQueue(config.unmanic_primary);
  if (mainQueue.length > config.queue_skip) {
    const item = mainQueue[config.queue_skip];
    if (await addByPath(item.abspath, secondary)) {
      await removeFromQueue(item, config.unmanic_primary);
    }
  }
};

const pad = (padStr, len, str, padLeft) => {
  const padString = padStr
    .repeat(Math.ceil(len / padStr.length))
    .substring(0, len);
  if (typeof str === "undefined") return padString;
  if (str.length > len) return str;
  if (padLeft) {
    return (padString + str).slice(-padString.length);
  } else {
    return (str + padString).substring(0, padString.length);
  }
};

const printLines = (url, obj) => {
  let lines = "";
  for (let i = 0; i < obj.processes.length; i++) {
    let printLine = pad(" ", 26, url);
    if (obj.processes[i].status === "active") {
      printLine +=
        "[" +
        pad(" ", 50, "*".repeat(Math.floor(obj.processes[i].percent * 50))) +
        "]  ";
      printLine +=
        pad(" ", 9, timePrinter(obj.processes[i].elapsed), true) + "  ";
      printLine +=
        pad(" ", 9, timePrinter(obj.processes[i].remaining), true) + "  ";
      printLine += obj.processes[i].file;
    } else {
      printLine += " ".repeat(76) + "[IDLE]";
    }
    lines += printLine + "\n";
  }
  return lines;
};

const timePrinter = (time) => {
  const hours = Math.floor(Math.floor(time / 60) / 60);
  const mins = Math.floor((time - hours * 60 * 60) / 60);
  const secs = Math.floor(time - hours * 60 * 60 - mins * 60);
  let returnStr = "";
  if (hours > 0) {
    returnStr = `${hours}h`;
  }
  if (hours > 0 || mins > 0) {
    returnStr = `${returnStr}${pad("0", hours > 0 ? 2 : 0, mins, true)}m`;
  }
  returnStr = `${returnStr}${pad(
    "0",
    hours > 0 || mins > 0 ? 2 : 0,
    secs,
    true
  )}s`;
  return returnStr;
};

const statsPrinter = (url) => {
  return `${pad(" ", 26, url)}${pad(
    " ",
    4,
    seenFiles[url].length,
    true
  )}  ${pad(
    " ",
    8,
    (
      seenFiles[url].length /
      ((Date.now() / 1000 - startTime / 1000) / (60 * 60 * 24))
    ).toFixed(2),
    true
  )}\n`;
};

const progressPrinter = (primary, secondaries) => {
  let printString = "";
  printString += "Current progress:\n";
  printString += `${pad(" ", 26, "Instance")}${pad(" ", 52, "Progress")}  ${pad(
    " ",
    9,
    "Elapsed"
  )}  ${pad(" ", 9, "Remaining")}  File\n`;
  printString += printLines(config.unmanic_primary.url, primary);
  for (let i = 0; i < config.unmanic_secondaries.length; i++) {
    printString += printLines(
      config.unmanic_secondaries[i].url,
      secondaries[i]
    );
  }

  printString += "\nOverall statistics:\n";
  printString += `${pad(" ", 26, "Instance")}Seen  Seen/Day\n`;
  printString += statsPrinter(config.unmanic_primary.url);
  for (let i = 0; i < config.unmanic_secondaries.length; i++) {
    printString += statsPrinter(config.unmanic_secondaries[i].url);
  }
  printString += `Total uptime: ${timePrinter(
    Math.floor(Date.now() / 1000 - startTime / 1000)
  )}\n`;
  return printString;
};

const doMoves = async (secondaries) => {
  for (let i = 0; i < config.unmanic_secondaries.length; i++) {
    for (let j = 0; j < secondaries[i].max - secondaries[i].running; j++) {
      try {
        await moveToQueue(config.unmanic_secondaries[i]);
      } catch (err) {
        logger.error("Failed during queue mover process", err);
      }
    }
  }
};

const check = async (move) => {
  let primary;
  const secondaries = [];
  try {
    primary = await check_instance(config.unmanic_primary);
  } catch (err) {
    logger.error("Failed to check main queue", err);
    return;
  }
  for (let i = 0; i < config.unmanic_secondaries.length; i++) {
    try {
      const this_secondary = await check_instance(
        config.unmanic_secondaries[i]
      );
      secondaries.push(this_secondary);
    } catch (err) {
      logger.error(
        `Failed to check secondary queue ${config.unmanic_secondaries[i].url}`,
        err
      );
      secondaries.push({
        running: 0,
        max: 0,
        processes: [],
      });
    }
  }
  if (move) {
    doMoves(secondaries);
  }
  return progressPrinter(primary, secondaries);
};

const start = async () => {
  await check(true);
  await sleep(60000);
  setImmediate(() => start());
};

const loadConfig = () => {
  if (fs.existsSync("./config-stored.json")) {
    config = JSON.parse(fs.readFileSync("./config-stored.json"));
  }
  if (!seenFiles[config.unmanic_primary.url]) {
    seenFiles[config.unmanic_primary.url] = [];
  }
  for (let i = 0; i < config.unmanic_secondaries.length; i++) {
    if (!seenFiles[config.unmanic_secondaries[i].url]) {
      seenFiles[config.unmanic_secondaries[i].url] = [];
    }
  }
};

const init = (loggerInstance, serverInstance) => {
  logger = loggerInstance.child({ source: "worker" });
  loadConfig();
  serverInstance.route([
    {
      method: "POST",
      path: "/config",
      handler: async (request, h) => {
        fs.writeFileSync(
          "./config-stored.json",
          JSON.stringify(request.payload)
        );
        loadConfig();
        return config;
      },
      config: {
        cors: {
          origin: ["*"],
        },
      },
    },
    {
      method: "GET",
      path: "/config",
      handler: async (request, h) => {
        return config;
      },
      config: {
        cors: {
          origin: ["*"],
        },
      },
    },
    {
      method: "GET",
      path: "/",
      handler: async (request, h) => {
        const response = h.response(await check());
        response.type("text/plain");
        return response;
      },
      config: {
        cors: {
          origin: ["*"],
        },
      },
    },
  ]);
  start();
};

module.exports = {
  init,
};
