import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import express from "express";
import imagemin from "imagemin";
import imageminJpegtran from "imagemin-jpegtran";
import imageminPngquant from "imagemin-pngquant";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
import xml2js from "xml2js";
dotenv.config();

const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL; // Replace with your Supabase URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY; // Replace with your Supabase anon key

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function autoScroll(page) {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
    });
  });
}

import { ExampleRouter } from "./routes/router_example.js";
app.use("/", ExampleRouter);

// the example shown below will be for logging, and it is run on every request
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const responseTime = Date.now() - start;
    const contentLength = res.get("Content-Length");
    console.log({
      method: req.method,
      url: req.originalUrl,
      query: req.query,
      responseTime: `${responseTime} ms`,
      contentLength: `${contentLength} bytes`,
      status: res.statusCode,
    });
  });
  // the next function is a callback that tells express to move on to the next middleware or route handler
  next();
});

app.get("/", (req, res) => {
  res.send("Choo Choo! Welcome to your Express app 🚅");
});

app.get("/json", (req, res) => {
  res.json({ "Choo Choo": "Welcome to your Express app 🚅" });
});

app.post("/post", (req, res) => {
  res.json({ "Choo Choo": "Welcome to your Express app 🚅", body: req.body });
});

app.get("/create-bucket", async (req, res) => {
  const bucketName = req.query.bucketName;
  const { data, error } = await supabase.storage.createBucket(bucketName, {
    public: false,
    allowedMimeTypes: ["image/png"],
    fileSizeLimit: 1024,
  });
  console.log({ data, error });
  res.json({ data, error });
});

app.get("/capture", async (req, res) => {
  const url = req.query.url;
  const resolutions = req.query.resolutions.split(",");
  const userId = req.query.userId;

  let urls = [];
  try {
    // Fetch and parse the sitemap
    const sitemapResponse = await fetch(`${url}/sitemap.xml`);
    const sitemapXml = await sitemapResponse.text();
    const sitemapJson = await xml2js.parseStringPromise(sitemapXml);

    if (sitemapJson.urlset) {
      // Regular sitemap
      urls = sitemapJson.urlset.url.map((u) => u.loc[0]);
    } else if (sitemapJson.sitemapindex) {
      // Sitemap index
      const sitemapUrls = sitemapJson.sitemapindex.sitemap.map((s) => s.loc[0]);
      for (let sitemapUrl of sitemapUrls) {
        const sitemapResponse = await fetch(sitemapUrl);
        const sitemapXml = await sitemapResponse.text();
        const sitemapJson = await xml2js.parseStringPromise(sitemapXml);
        if (sitemapJson.urlset) {
          urls.push(...sitemapJson.urlset.url.map((u) => u.loc[0]));
        }
      }
    }

    urls = [...new Set(urls)];
  } catch (error) {
    console.error("Failed to fetch sitemap:", error.message);

    urls = [url];
  }

  console.log({ urls, resolutions });

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const allPromises = [];

  for (let pageUrl of urls) {
    for (let resolution of resolutions) {
      allPromises.push(
        (async () => {
          const page = await browser.newPage();
          try {
            const [width, height] = resolution.split("x").map(Number);
            await page.setViewport({ width, height });
            await page.goto(pageUrl, {
              waitUntil: "networkidle0",
              timeout: 0,
            });

            await autoScroll(page);

            const screenshot = await page.screenshot({ fullPage: true });

            // Adjusted websiteFolder and pageName extraction
            const urlParts = pageUrl
              .replace(/https?:\/\/(www\.)?/, "")
              .split("/");
            const websiteFolder = urlParts[0]; // Assumes the domain is always the first part
            const pageName = urlParts.slice(1).join("_") || "index"; // Joins the rest of the path, or defaults to "index"

            const resolutionFolder = resolution;
            const screenshotName = `${pageName}.png`;
            const storagePath = `${userId}/${websiteFolder}/${resolutionFolder}/${screenshotName}`;
            console.log({ storagePath });
            const { error: uploadError } = await supabase.storage
              .from("screenshots")
              .upload(storagePath, screenshot);

            if (uploadError) {
              console.error(
                "Failed to upload screenshot to Supabase:",
                uploadError.message
              );
            } else {
              console.log("Screenshot uploaded to Supabase:", storagePath);
            }
            /*  */

            // await imagemin([filePath], {
            //   destination: dirPath,
            //   plugins: [
            //     imageminJpegtran(),
            //     imageminPngquant({
            //       quality: [0.6, 0.8],
            //     }),
            //   ],
            // });

            // console.log("Screenshot saved:", filePath);
          } catch (error) {
            console.error(
              `Failed to process ${pageUrl} at resolution ${resolution}:`,
              error.message
            );
          } finally {
            await page.close();
          }
        })()
      );
    }
  }

  // Wait for all promises to resolve
  await Promise.all(allPromises);

  await browser.close();
  res.send("Screenshots captured and saved locally.");
});

const port = process.env.PORT || 3001;

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
