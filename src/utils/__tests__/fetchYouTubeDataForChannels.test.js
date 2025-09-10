const { execFile } = require("child_process");
const fetchYouTubeDataForChannels = require("../fetchYouTubeDataForChannels");

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

describe("fetchYouTubeDataForChannels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("throws TypeError if channelIdsOrUrls is not an array", async () => {
    await expect(fetchYouTubeDataForChannels("not an array")).rejects.toThrow(
      TypeError
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  test("throws Error if channelIdsOrUrls is empty", async () => {
    await expect(fetchYouTubeDataForChannels([])).rejects.toThrow(Error);
    expect(execFile).not.toHaveBeenCalled();
  });

  test("throws TypeError if any item is not a non-empty string", async () => {
    await expect(fetchYouTubeDataForChannels([123, ""])).rejects.toThrow(
      TypeError
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  test("throws Error for invalid channel identifier", async () => {
    await expect(fetchYouTubeDataForChannels(["invalid"])).rejects.toThrow(
      Error
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  test("fetches data successfully and returns correct shape", async () => {
    // Mock playlist fetch
    execFile.mockImplementationOnce((cmd, args, opts, callback) => {
      if (args.includes("--flat-playlist")) {
        const mockPlaylist = {
          entries: [
            { id: "video1", title: "Video 1" },
            { id: "video2", title: "Video 2" },
            { id: "video3", title: "Video 3" },
          ],
        };
        callback(null, JSON.stringify(mockPlaylist), "");
      }
    });

    // Mock video fetches
    execFile.mockImplementation((cmd, args, opts, callback) => {
      if (args.includes("video1")) {
        const mockVideo = {
          id: "video1",
          title: "Video 1",
          duration: 300,
          view_count: "1000",
          upload_date: "20230101",
        };
        callback(null, JSON.stringify(mockVideo), "");
      } else if (args.includes("video2")) {
        const mockVideo = {
          id: "video2",
          title: "Video 2",
          // duration missing
          view_count: "2000",
          upload_date: "20230201",
        };
        callback(null, JSON.stringify(mockVideo), "");
      } else if (args.includes("video3")) {
        const mockVideo = {
          id: "video3",
          title: "Video 3",
          duration: 400,
          // view_count missing
          upload_date: "20230301",
        };
        callback(null, JSON.stringify(mockVideo), "");
      }
    });

    const result = await fetchYouTubeDataForChannels(["@testchannel"]);

    expect(result).toMatchSnapshot();
    expect(result[0].channel).toBe("@testchannel");
    expect(result[0].videos).toHaveLength(3);
    expect(result[0].videos[0]).toEqual({
      id: "video1",
      title: "Video 1",
      url: "https://www.youtube.com/watch?v=video1",
      duration: 300,
      viewCount: 1000,
      uploadDate: "20230101",
    });
    expect(result[0].videos[1]).toEqual({
      id: "video2",
      title: "Video 2",
      url: "https://www.youtube.com/watch?v=video2",
      duration: null,
      viewCount: 2000,
      uploadDate: "20230201",
    });
    expect(result[0].videos[2]).toEqual({
      id: "video3",
      title: "Video 3",
      url: "https://www.youtube.com/watch?v=video3",
      duration: 400,
      viewCount: null,
      uploadDate: "20230301",
    });
  }, 20000);

  test("handles channel-level error for malformed JSON", async () => {
    execFile.mockImplementationOnce((cmd, args, opts, callback) => {
      if (args.includes("--flat-playlist")) {
        callback(null, "invalid json", "");
      }
    });

    const result = await fetchYouTubeDataForChannels(["@testchannel"]);

    expect(result[0].channel).toBe("@testchannel");
    expect(result[0].error.code).toBe("YTDLP_CHANNEL_FETCH_FAILED");
    expect(result[0].videos).toEqual([]);
  });

  test("handles per-video failure and includes debug if enabled", async () => {
    // Mock playlist fetch
    execFile.mockImplementationOnce((cmd, args, opts, callback) => {
      if (args.includes("--flat-playlist")) {
        const mockPlaylist = {
          entries: [
            { id: "video1", title: "Video 1" },
            { id: "video2", title: "Video 2" },
          ],
        };
        callback(null, JSON.stringify(mockPlaylist), "");
      }
    });

    // Mock video fetches: first succeeds, second fails
    execFile.mockImplementation((cmd, args, opts, callback) => {
      if (args.includes("video1")) {
        const mockVideo = {
          id: "video1",
          title: "Video 1",
          duration: 300,
        };
        callback(null, JSON.stringify(mockVideo), "");
      } else if (args.includes("video2")) {
        callback(new Error("Video fetch failed"), "", "stderr");
      }
    });

    const result = await fetchYouTubeDataForChannels(["@testchannel"], {
      debug: true,
    });

    expect(result[0].videos).toHaveLength(1);
    expect(result[0].videos[0].id).toBe("video1");
    expect(result[0].debug).toContain(
      "Failed to fetch video video2: yt-dlp failed: Video fetch failed\nstdout: \nstderr: stderr"
    );
  }, 10000);

  test("clamps limit to 1-200", async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      if (args.includes("--flat-playlist")) {
        const limitFromArgs = parseInt(args[3]);
        const mockPlaylist = {
          entries: Array.from({ length: limitFromArgs }, (_, i) => ({
            id: `video${i}`,
            title: `Video ${i}`,
          })),
        };
        callback(null, JSON.stringify(mockPlaylist), "");
      } else {
        const mockVideo = { id: args[2].split("=")[1], title: "Test" };
        callback(null, JSON.stringify(mockVideo), "");
      }
    });

    const result = await fetchYouTubeDataForChannels(["@testchannel"], {
      limit: 250,
    });
    expect(result[0].videos).toHaveLength(200);

    const result2 = await fetchYouTubeDataForChannels(["@testchannel"], {
      limit: 0,
    });
    expect(result2[0].videos).toHaveLength(1);
  });

  test("handles multiple channels", async () => {
    execFile.mockImplementation((cmd, args, opts, callback) => {
      if (args.includes("--flat-playlist")) {
        const mockPlaylist = {
          entries: [{ id: "video1", title: "Video 1" }],
        };
        callback(null, JSON.stringify(mockPlaylist), "");
      } else {
        const mockVideo = { id: args[2].split("=")[1], title: "Test" };
        callback(null, JSON.stringify(mockVideo), "");
      }
    });

    const result = await fetchYouTubeDataForChannels([
      "@channel1",
      "@channel2",
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].channel).toBe("@channel1");
    expect(result[1].channel).toBe("@channel2");
    expect(execFile).toHaveBeenCalledTimes(4); // 2 playlist + 2 video calls
  });
});
