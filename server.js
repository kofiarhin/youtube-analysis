const express = require("express");
const app = express();

const fetchYouTubeDataForChannels = require("./src/utils/fetchYouTubeDataForChannels");

app.get("/", async (req, res, next) => {
  const result = await fetchYouTubeDataForChannels(
    [
      "https://www.youtube.com/@devkofi",
      "https://www.youtube.com/@ThePrimeTimeagen",
      "https://www.youtube.com/@t3dotgg",
      "https://www.youtube.com/@TraversyMedia",
    ],
    { limit: 600, debug: true }
  );
  return res.json(result);
});

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log("server started");
});
