# AWS image storage

Status: **prepared, not applied or migrated**. The repository owns the stack,
manifest and verification tools. All tracked images remain available. No AWS
resource, IAM grant, DNS record, certificate, production deployment or Git
history has been changed by this preparation.

## Inventory and boundary

The manifest is generated from an ordinary production build's HTML, structured
image data and CSS. It follows complete first-party URLs, responsive candidates,
Astro island props and JSON-LD, excluding prose/code examples and external images.
It fails on missing source bytes; it does not silently discard missing images.
Only raster images in `/blog/media/`, `/recipes/media/` and `/images/` qualify.

At main `22008ddf8c5bf9f46fe7033efd246c8e2dba3f82`:

| Scope | Tracked files | Bytes | Published candidates | Candidate bytes |
| --- | ---: | ---: | ---: | ---: |
| Blog media | 449 | 17,166,960 | 449 | 17,166,960 |
| Recipe media | 450 | 57,505,718 | 417 | 54,837,970 |
| Portfolio images | 2 | 251,244 | 1 | 89,706 |
| Total | 901 | 74,923,922 | 867 | 72,094,636 |

The 12 `src/images/` Astro authoring inputs (522,410 bytes, including photos
and hand-authored SVGs) are a separate follow-up: preserve Astro optimization
and hydrate the original inputs before the compiler runs, rather than treating
its generated `/_astro/` images as upload sources.

The other 34 public raster images are outside the published-reference manifest. Keep them in
Git pending explicit classification; do not publish them merely to simplify a
sync. Icons, hand-authored SVGs, fonts, notebooks, resume, generated JS/CSS,
recipe data, test fixtures, legacy redirect files and historical worker fixtures
are excluded. Original Blogthedata S3/CloudFront and migration backups remain
retained. This stack neither imports nor changes them.

## Storage contract

`config/aws/static-assets/template.json` creates a separately owned stack in
`us-east-1`: encrypted, versioned S3 with all public-access blocks enabled and ACLs
disabled, plus CloudFront OAC signing against the regional S3 REST endpoint.
Only that distribution can read `sha256/*`; TLS is required. There are no IAM
roles, user credentials, public bucket ACLs, custom domains, DNS or certificate
resources. The bucket and its policy retain on deletion/replacement. The supplied
stack policy also refuses their replacement/deletion during updates. There is
no expiration, destructive sync or automatic cleanup of old release objects.

Each manifest row pins the original public path, full SHA-256, byte length,
content type and immutable key:

```text
sha256/<full SHA-256>/blog/media/example.webp
```

Uploads use the measured image type and
`Cache-Control: public, max-age=31536000, immutable`, conditional on the key not
already existing. A mismatched existing object stops the uploader. The verifier
GETs every CloudFront URL and checks actual bytes, hashes and both headers;
ETags and S3 metadata alone never establish preservation. Upload retries are
bounded, use delays, and tolerate CloudFront's brief negative cache after a PUT.
No object is deleted or intentionally overwritten.

## Local review and validation

With repository setup complete and pinned Node 24:

```bash
npm run build
npm run assets -- inventory
npm run assets -- check
npm run check:ts
npm test
npm run gate
```

`inventory` deliberately updates the committed manifest after a reviewed build.
`check` rejects changed bytes, stale/unpublished entries and uncovered published
references. Ordinary `check:ts` includes the strict asset-tool TypeScript project.
Offline Vitest coverage includes byte/header mismatches, missing objects,
idempotency, retry limits, negative caching, publication boundaries, source
symlinks, exact upload destinations and a real CLI/TS-loader fixture.

The public `/John-Solly-Resume.pdf` URL remains unchanged, including consumers
in the separate profile repository.

The new CloudFormation template passed AWS `ValidateTemplate` on November 1,
2026. That is template validation, not stack creation or proof of runtime access.
Minimal discovery found retained `blogthedata` storage. AgentMcp explicitly
denied `cloudfront:ListDistributions`; it was not retried with another identity.
No upload capability to the intended new bucket exists before human apply.

## Human apply and upload handoff

John owns infrastructure apply. Review the template, retention/stack policy,
manifest and cost before running these commands with his approved access.
These are handoff commands, not instructions for an agent to acquire credentials.

```bash
aws cloudformation create-stack --region us-east-1 \
  --stack-name jsolly-website-static-assets \
  --template-body file://config/aws/static-assets/template.json \
  --stack-policy-body file://config/aws/static-assets/stack-policy.json
aws cloudformation wait stack-create-complete --region us-east-1 \
  --stack-name jsolly-website-static-assets
aws cloudformation describe-stacks --region us-east-1 \
  --stack-name jsolly-website-static-assets --query 'Stacks[0].Outputs'
```

Save the exact `BucketName`, `DeliveryOrigin` and `DistributionId` outputs.
Wait for the distribution to finish deploying. First review the upload plan:

```bash
npm run assets -- plan BUCKET_NAME
```

This prints one conditional AWS CLI PUT per manifest object and executes none.
John can run the reviewed commands with existing approved write access. An
existing-key precondition failure requires verification, never overwrite or
`sync --delete`. Alternatively, an approved operator can provide an external
JSON map from each immutable key to its short-lived presigned regional S3 PUT
URL. Sign for the exact bucket/key, image type, cache header and `If-None-Match: *`;
keep the credential-bearing map outside the repository. No identity discovery,
credential installation or automatic presigning is performed here.

```bash
npm run assets -- upload DELIVERY_ORIGIN BUCKET_NAME /absolute/private/put-urls.json
npm run assets -- verify DELIVERY_ORIGIN /absolute/external/image-verification.json
```

The uploader checks all local source bytes before its first PUT, resumes already
verified objects, and verifies delivery after each upload. It accepts only the
exact supplied bucket's `s3.us-east-1.amazonaws.com` endpoint and manifest keys.
It does not follow redirects or log signed URLs. The normal Node session proxy
and CA trust remain enabled. The final `verify` needs only public CloudFront
GET access. Its optional, create-only external receipt records the manifest file
hash, origin, object count and verification time. Retain it with the original
source snapshot for review. Verification failures never authorize Git removal.

## Cutover and rollback still required

Keep existing public URLs. The smallest follow-up is to materialize verified
immutable objects from AWS into the same-origin build output and local developer
workspace before image-dependent build/tests run. AWS becomes the durable media
source; Vercel continues serving the existing paths as deployment artifacts.
This avoids runtime proxy rules and preserves CSP, responsive WebPs, OG/image
links, SEO links and recipe worker response/cache contracts. It also avoids a
new domain or browser CORS requirement. Runtime CloudFront rewrites can be
reviewed separately if desired; they require provider routing and offline/PWA
proof and should not be silently substituted.

That follow-up must be implemented and validated before deleting images:

1. Verify all 867 objects against this exact manifest; retain the receipt and an
   independent original source snapshot. Confirm unauthenticated S3 access is
   denied and intended CloudFront GETs succeed.
2. Add repository-owned materialization with atomic verified writes, exact-path
   ignores and checks against the committed manifest. Prove a fresh checkout
   builds without any other checkout, local cache or untracked source directory.
   Keep ordinary offline tests on fake transports; explicitly provision the
   immutable media inputs before full source/build gates.
3. Update image-integrity and recipe provenance checks to work after hydration.
   Preserve their byte evidence. Prove prior release assets, old posts, OG URLs,
   legacy redirects and real recipe install/update/offline behavior remain usable.
4. Change PagesCMS's Git-backed media intake to the reviewed external upload
   workflow so new images do not return to Git. Text posts retain their existing
   root-relative image paths. Do not disable the current editor before replacement
   intake works, and never upload draft/private material as a side effect.
5. Only then remove exactly verified tracked candidates in a separate reviewable
   commit. Keep previous immutable keys and retained release data indefinitely;
   no history rewrite. Run the full gate, independent review, draft PR CI and a
   normal Vercel Preview before any human merge/deployment decision.

Until these checks pass, rollback is the untouched current source and serving
behavior. After cutover, rollback restores the previous manifest and rehydrates
its retained objects, or restores the independent source snapshot. S3 versioning
adds recovery options; it is not permission to expire old keys or backups.

## Cost before apply

The initial selected payload is 72.1 MB (about 0.067 GiB), 867 objects. Storage
is tiny: at an illustrative $0.03/GB-month rate it would be roughly $0.002/month
for one retained copy; use the actual region's current rate before applying.
Versions and retained releases accumulate, and every PUT/GET is metered. One
initial upload entails up to 867 PUTs and verification at least 867 CloudFront
GETs; retry/resume checks add GETs. Hydration would download about 72.1 MB per
uncached full build. Existing Vercel delivery costs remain part of that design.

CloudFront uses PriceClass_100 and ordinary usage billing, with no flat-rate plan
subscription created by this stack. Viewer requests and transfer determine most
potential delivery cost. Account-wide free allowances may already be consumed;
do not promise zero cost. Recheck [S3 pricing](https://aws.amazon.com/s3/pricing/)
and [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) and estimate
traffic/build volume with John before apply. No logging bucket, analytics tier,
image-transformation Lambda or ongoing image-recompression service is added.
