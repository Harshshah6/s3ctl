import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Command } from "commander";
import cliProgress from "cli-progress";
import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    DeleteObjectCommand,
    PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import "dotenv/config";

/* ================= CONFIG ================= */

const REQUIRED_ENV = [
    "S3_ENDPOINT",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
];

for (const v of REQUIRED_ENV) {
    if (!process.env[v]) {
        console.error(`❌ Missing environment variable: ${v}`);
        process.exit(1);
    }
}


const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "garage",
    forcePathStyle: true,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
    },
});


/* ========================================== */

const program = new Command();

program
    .name("garage-cli")
    .description("S3 CLI for Garage / MinIO compatible storage")
    .version("1.2.0");

/* ---------- Helpers ---------- */

function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function listAllObjects(bucket, prefix = "") {
    let token;
    const objects = [];

    do {
        const res = await s3.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: token,
            })
        );
        if (res.Contents) objects.push(...res.Contents);
        token = res.NextContinuationToken;
    } while (token);

    return objects;
}

async function parallelRun(items, limit, fn) {
    const queue = [...items];
    const workers = Array.from({ length: limit }, async () => {
        while (queue.length) {
            const item = queue.shift();
            if (!item) return;
            await fn(item);
        }
    });
    await Promise.all(workers);
}

/* ---------- Upload ---------- */

async function uploadFile(bucket, filePath, key) {
    const size = fs.statSync(filePath).size;
    const bar = new cliProgress.SingleBar({
        format: `${key} | {bar} | {percentage}% | {value}/{total}`,
    });

    bar.start(size, 0);

    const upload = new Upload({
        client: s3,
        params: {
            Bucket: bucket,
            Key: key,
            Body: fs.createReadStream(filePath),
        },
    });

    upload.on("httpUploadProgress", (p) => {
        if (p.loaded) bar.update(p.loaded);
    });

    await upload.done();
    bar.stop();
    console.log(`✅ Uploaded ${key}`);
}

async function collectFiles(dir, prefix, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const key = path.posix.join(prefix, e.name);

        if (e.isDirectory()) {
            await collectFiles(full, key, out);
        } else {
            out.push({ full, key });
        }
    }
    return out;
}

/* ---------- Commands ---------- */

program
    .command("upload <bucket> <src> [dest]")
    .description("Upload file or folder (parallel)")
    .option("-p, --parallel <n>", "Parallel uploads", "5")
    .action(async (bucket, src, dest = path.basename(src), opts) => {
        dest = dest.replace(/\\/g, "/");
        const stat = fs.statSync(src);
        const parallel = Number(opts.parallel);

        if (stat.isDirectory()) {
            const files = await collectFiles(src, dest);
            await parallelRun(files, parallel, (f) =>
                uploadFile(bucket, f.full, f.key)
            );
        } else {
            await uploadFile(bucket, src, dest);
        }
    });

program
    .command("download <bucket> <key> <dest>")
    .description("Download object or prefix")
    .option("-r, --recursive", "Recursive")
    .option("-p, --parallel <n>", "Parallel downloads", "5")
    .action(async (bucket, key, dest, opts) => {
        if (!opts.recursive) {
            const { Body } = await s3.send(
                new GetObjectCommand({ Bucket: bucket, Key: key })
            );
            ensureDir(dest);
            await pipeline(Body, fs.createWriteStream(dest));
            console.log(`⬇ ${key}`);
            return;
        }

        const objects = await listAllObjects(bucket, key);
        const parallel = Number(opts.parallel);

        await parallelRun(objects, parallel, async (obj) => {
            const rel = obj.Key.slice(key.length).replace(/^\/+/, "");
            const out = path.join(dest, rel);
            ensureDir(out);

            const { Body } = await s3.send(
                new GetObjectCommand({ Bucket: bucket, Key: obj.Key })
            );
            await pipeline(Body, fs.createWriteStream(out));
            console.log(`⬇ ${obj.Key}`);
        });
    });

program
    .command("delete <bucket> <key>")
    .description("Delete object or prefix")
    .option("-r, --recursive", "Recursive delete")
    .option("--dry-run", "Show what would be deleted")
    .option("--yes", "Confirm destructive operation")
    .option("-p, --parallel <n>", "Parallel deletes", "5")
    .action(async (bucket, key, opts) => {
        if (!opts.recursive) {
            if (!opts.yes) {
                console.error("❗ Use --yes to confirm delete");
                process.exit(1);
            }
            await s3.send(
                new DeleteObjectCommand({ Bucket: bucket, Key: key })
            );
            console.log(`❌ Deleted ${key}`);
            return;
        }

        const objects = await listAllObjects(bucket, key);

        if (opts.dryRun) {
            for (const o of objects) console.log(`[dry-run] ${o.Key}`);
            console.log(`\n${objects.length} objects would be deleted`);
            return;
        }

        if (!opts.yes) {
            console.error(
                `❗ Refusing to delete ${objects.length} objects without --yes`
            );
            process.exit(1);
        }

        const parallel = Number(opts.parallel);

        await parallelRun(objects, parallel, async (o) => {
            await s3.send(
                new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: o.Key,
                })
            );
            console.log(`❌ ${o.Key}`);
        });

        console.log(`Deleted ${objects.length} objects`);
    });

program
    .command("list <bucket> [prefix]")
    .description("List objects (recursive)")
    .action(async (bucket, prefix = "") => {
        const objects = await listAllObjects(bucket, prefix);
        let total = 0;

        for (const o of objects) {
            total += o.Size;
            console.log(o.Key, formatBytes(o.Size));
        }

        console.log(`\n${objects.length} objects — ${formatBytes(total)}`);
    });

program
    .command("presign <bucket> <key>")
    .option("-e, --expires <seconds>", "Expiry", "3600")
    .action(async (bucket, key, opts) => {
        console.log(
            await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucket, Key: key }),
                { expiresIn: Number(opts.expires) }
            )
        );
    });

program
    .command("presign-put <bucket> <key>")
    .option("-e, --expires <seconds>", "Expiry", "600")
    .action(async (bucket, key, opts) => {
        console.log(
            await getSignedUrl(
                s3,
                new PutObjectCommand({ Bucket: bucket, Key: key }),
                { expiresIn: Number(opts.expires) }
            )
        );
    });

program.parse();
