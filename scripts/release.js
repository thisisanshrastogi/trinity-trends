import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';

const run = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' });

async function main() {
    p.intro(pc.bgBlue(pc.black('TRINITY TRENDS RELEASE MANAGER ')));

    const pkgPath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(pkgPath)) {
        p.log.error('Could not find package.json. Please run this from the project root.');
        process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const VERSION = pkg.version;
    const DIST_NAME = `trinity-trends-v${VERSION}`;
    const tarballPath = path.join('dist_release', `${DIST_NAME}.tar.gz`);
    const manifestPath = path.join('dist_release', 'manifest.json');

    if (!fs.existsSync(tarballPath) || !fs.existsSync(manifestPath)) {
        p.log.error(`Release artifacts for v${VERSION} not found!`);
        p.log.info('Please run `npm run build` (or `node scripts/build.js`) first to package the release.');
        process.exit(1);
    }

    p.note(
        `Version: v${VERSION}\nArchive: ${tarballPath}`,
        'Release Info'
    );

    // CRITICAL: Remind them about the manifest.json
    const hasPushed = await p.confirm({
        message: 'CRITICAL: Have you committed and pushed `dist_release/manifest.json` and code changes to the `main` branch?',
        initialValue: false,
    });

    if (p.isCancel(hasPushed)) {
        p.log.info('Release cancelled.');
        process.exit(0);
    }

    if (!hasPushed) {
        p.log.warn('You MUST push `manifest.json` to the `main` branch on GitHub.');
        p.log.info('The CLI clients constantly fetch the raw manifest from the `main` branch to detect if there are new updates.');
        p.log.info('Please run `git add`, `git commit`, `git push origin main`, AND `git push --tags` before creating this GitHub Release.');
        process.exit(0);
    }

    const title = await p.text({
        message: 'Enter release title:',
        initialValue: `v${VERSION} Release`,
        validate: (value) => {
            if (!value) return 'Title is required';
        }
    });
    if (p.isCancel(title)) process.exit(0);

    const notes = await p.text({
        message: 'Enter release notes (what changed?):',
        initialValue: `Automated release for v${VERSION}`,
        validate: (value) => {
            if (!value) return 'Release notes are required';
        }
    });
    if (p.isCancel(notes)) process.exit(0);

    const confirm = await p.confirm({
        message: `Create GitHub Release for v${VERSION} now?`,
        initialValue: true
    });

    if (p.isCancel(confirm) || !confirm) {
        p.log.info('Release cancelled.');
        process.exit(0);
    }

    const s = p.spinner();
    s.start('Creating GitHub Release and uploading archive...');

    try {
        const safeTitle = title.replace(/"/g, '\\"');
        const safeNotes = notes.replace(/"/g, '\\"');

        // Execute the gh cli command
        run(`gh release create v${VERSION} "${tarballPath}" -t "${safeTitle}" -n "${safeNotes}"`);

        s.stop(pc.green(`GitHub Release v${VERSION} created successfully!`));
        p.log.success(`Check it out at: https://github.com/${getRepo(pkg)}/releases/tag/v${VERSION}`);
    } catch (err) {
        s.stop(pc.red('Failed to create GitHub release.'));
        p.log.error(err.message);
        if (err.stderr) p.log.error(err.stderr);
    }
}

function getRepo(pkg) {
    const repo = pkg.repository?.url?.match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1] || pkg.repository || 'thisisanshrastogi/trinity-trends';
    return repo.replace(/\.git$/, '');
}

main().catch(console.error);
