# s3ctl

A fast, safe, **S3-compatible CLI** for **Garage / MinIO / custom S3 endpoints**.

* ✔ Recursive upload / download / delete
* ✔ Parallel operations
* ✔ Dry-run deletes + confirmation
* ✔ Presigned URLs
* ✔ Docker, Docker Compose, native binaries
* ✔ `.env` support
* ✔ Shell autocomplete
* ✔ GitHub Releases

---

## Features

* Upload files or folders (recursive)
* Download files or prefixes
* Recursive delete with **dry-run** and **`--yes` confirmation**
* Parallel uploads/downloads/deletes
* Presigned GET and PUT URLs
* Works with Garage, MinIO, and AWS S3-compatible storage
* Safe credential handling via environment variables
* Distributed as:

  * Node CLI
  * Docker image
  * Single-file binaries (Linux / macOS / Windows)

---

## Installation

### Option 1 — Using node

```bash
git clone github.com/harshshah6/s3ctl
cd s3ctl
```

```bash
npm i
node script.js
```
>ensure you create .env file before running script

---

### Option 2 — Docker

```bash
docker build -t s3ctl .
docker run --rm s3ctl --help
```

---

## Configuration

### Environment Variables

| Variable        | Required | Description              |
| --------------- | -------- | ------------------------ |
| `S3_ENDPOINT`   | ✅        | S3-compatible endpoint   |
| `S3_REGION`     | ❌        | Region (default: garage) |
| `S3_ACCESS_KEY` | ✅        | Access key               |
| `S3_SECRET_KEY` | ✅        | Secret key               |

---

### `.env` example (recommended)

```env
S3_ENDPOINT=https://s3.example.com
S3_REGION=garage
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=yyy
```

> ⚠️ Never commit `.env` files.

---

## Usage

### List objects

```bash
s3ctl list mybucket
s3ctl list mybucket prefix/
```

---

### Upload

```bash
s3ctl upload mybucket file.txt
s3ctl upload mybucket ./folder folder
```

Parallel uploads:

```bash
s3ctl upload mybucket ./folder folder -p 10
```

---

### Download

```bash
s3ctl download mybucket file.txt ./file.txt
s3ctl download mybucket folder ./local -r -p 8
```

---

### Delete (SAFE)

#### Dry-run (no deletion)

```bash
s3ctl delete mybucket folder -r --dry-run
```

#### Actual delete (requires confirmation)

```bash
s3ctl delete mybucket folder -r --yes -p 20
```

---

### Presigned URLs

```bash
s3ctl presign mybucket file.txt
s3ctl presign-put mybucket upload.txt
```

---

## Security

* No credentials hardcoded
* Environment-based authentication
* Destructive operations require explicit `--yes`
* Dry-run supported for deletes

---

## Development

```bash
npm install
node script.js --help
```

---

## Roadmap

* `aws s3 cp` compatible syntax
* Sync (`rsync` style)
* Config profiles
* Encrypted credential storage
* Rate limiting

---

## License

MIT