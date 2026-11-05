# Legacy blog host operations

The blog and recipes now live at <https://www.jsolly.com/blog/> and
<https://www.jsolly.com/recipes/>. [awesome-blog](https://github.com/jsolly/awesome-blog)
was archived on October 9, 2026 after archive-notice PR703. Its public MIT history
remains available; the active website repository is private.

## Deployment and monitoring

Vercel project `blogthedata` (`prj_QxSNy3z51xOp295HUvPfDa1JY9h8`, team
`jsollys-projects`) is connected to `jsolly/jsolly-website`, production branch
`main`, Root Directory `legacy/blogthedata`. It serves `blogthedata.com`,
`www.blogthedata.com` and `blogthedata.vercel.app`. Never reconnect the archived source.

Auto-assign Custom Production Domains is off. It stays off through the soak ending
October 23, 2026; John decides whether to restore it after reviewing monitoring.
New Git deployments are staged. Verify a redirect edit on its staged URL before
any separately authorized promotion; a website release is not proof of legacy
redirect promotion. The intended website project is `jsolly-website`
(`prj_9irfTPLYZwwuC7YK0oB3bkc1QXtW`). Its Production smoke selects the Vercel bot,
Production environment and `https://jsolly-website-` deployment URL prefix.

`.github/workflows/legacy-redirects.yml` runs daily and on manual dispatch. It
verifies public redirects with `monitoring/verify-blogthedata-cutover.mjs` and records
artifacts even on failure. `url-map.json` is the frozen redirect contract,
`url-union.json` its source inventory, and `fragment-ids.json` preserves headings.
Their source freeze SHA is `6545bc279bb906ac6fdb53cb0e0d7946d0f5b4c9`. Keep legacy feed
IDs, case-sensitive paths and both retiring service workers unchanged.

C2 passed all 7,792 production checks on October 9, 2026. Double-slash probes
received a same-host 308 normalization followed by the expected 301 destination,
including the root, leading double slash and trailing double slash forms on all
three old hosts. `/wp-login.php` alone may return 403 with
`x-vercel-mitigated: deny` and no Location instead of 404, under John's exact-path
approval. Other 404 checks remain strict; no security protection was disabled.

The promoted redirect build is `dpl_B8xPDJsxu9vkPmgLzxEU7JC8ycL8`,
<https://blogthedata-jas5p97oh-jsollys-projects.vercel.app>, from
`fa9249762c873fbb03a79600768a0b8c6c949a25`. Monitoring landed in
[PR106](https://github.com/jsolly/jsolly-website/pull/106), release
`834c8664d3b5e9db2da8829823a2da3f9de74070`; its
[legacy sample verification](https://github.com/jsolly/jsolly-website/actions/runs/37929163354)
and [exact website production smoke](https://github.com/jsolly/jsolly-website/actions/runs/37929227438)
passed. Website deploy success and legacy deployment success are distinct.

## Recovery and retained resources

The original full-blog rollback deployment is `dpl_6HZzAQxVN9Q71SEMF1Yxr5b74PR4`,
<https://blogthedata-kzcuzzfmm-jsollys-projects.vercel.app>, source SHA
`6545bc279bb906ac6fdb53cb0e0d7946d0f5b4c9`. It remained available after monitoring
landed. In Vercel Instant Rollback, choose this deployment explicitly: the default
previous candidate may be a newer staged redirect build. Roll back the legacy
redirect cutover before rolling back the website integration. Do not execute a
rollback merely to inspect availability.

John keeps blogthedata.com indefinitely with auto-renew enabled, currently paid
through August 6, 2028. Keep Google/Bing verification DNS records. Google Change
of Address was filed October 9, 2026; both Bing properties are verified and the
destination sitemap submitted. Bing provided no Site Move control; John accepted
that evidence. Review coverage again November 8, 2026.

John chose on October 28, 2026 to retain the migration backup for several years
and manage its Glacier Deep Archive lifecycle in this repository. The existing
standalone AWS stack `blogthedata-migration-backups` keeps its identity and
protections. [Backup infrastructure](migration-backups.md) owns its template,
review and human apply procedure. Source ownership does not establish deployment;
verify the live lifecycle and eventual storage-class transition separately.
Object Lock retention ends November 1, 2026. No teardown is authorized.

Heroku release v315, database and media remain for recovery until John's separate
retirement decision after the soak. Blog images are now [rehosted on this site](blog-images.md), with responsive
WebPs and original-source receipts. The `blogthedata` S3 bucket and CloudFront
distribution remain retained; rehosting does not authorize their retirement.
Preserve private exports, independent backups, the recipe archive and migration
receipts. Git history retains the completed plan bundle. The source repository
can be unarchived for an authorized recovery.
