# תיק צ׳יק on Railway: one Node server, with Chromium for the reports and the morning alerts (the page runs headless).
FROM node:22-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright TZ=Asia/Jerusalem
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fonts-dejavu-core && rm -rf /var/lib/apt/lists/* /root/.npm
COPY . .
RUN node tools/build.js
EXPOSE 3000
CMD ["node","--disable-warning=ExperimentalWarning","server/index.js"]
