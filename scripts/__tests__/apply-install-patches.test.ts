import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import { applyInstallPatches } from '../apply-install-patches';

const PATCH = path.resolve(import.meta.dir, '../../patches/ink@6.2.0.patch');
const temporaryRoots: string[] = [];

function fixture(source: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-patch-test-'));
    temporaryRoots.push(root);
    const target = path.join(root, 'node_modules/ink/build/parse-keypress.js');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source, 'utf8');
    return root;
}

const ORIGINAL = `const parseKeypress = (s = '') => {
    const key = {};
    if (s === '\\b' || s === '\\x1b\\b') {
        // backspace or ctrl+h
        key.name = 'backspace';
        key.meta = s.charAt(0) === '\\x1b';
    }
    else if (s === '\\x7f' || s === '\\x1b\\x7f') {
        // TODO(vadimdemedes): \`enquirer\` detects delete key as backspace, but I had to split them up to avoid breaking changes in Ink. Merge them back together in the next major version.
        // delete
        key.name = 'delete';
        key.meta = s.charAt(0) === '\\x1b';
    }
    else if (s === '\\x1b' || s === '\\x1b\\x1b') {
        // escape key
        key.name = 'escape';
        key.meta = s.length === 2;
    }
};
`;

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('install patch', () => {
    it('applies the Ink backspace patch and converges', () => {
        const root = fixture(ORIGINAL);

        expect(applyInstallPatches(root, PATCH)).toBe('applied');
        expect(applyInstallPatches(root, PATCH)).toBe('present');
        expect(
            fs.readFileSync(
                path.join(root, 'node_modules/ink/build/parse-keypress.js'),
                'utf8'
            )
        ).toContain('key.name = \'backspace\';');
    });

    it('rejects an unknown Ink source state', () => {
        const root = fixture(ORIGINAL.replace(
            'key.name = \'delete\';',
            'key.name = \'other\';'
        ));

        expect(() => applyInstallPatches(root, PATCH)).toThrow(
            'matches neither the expected source nor patched state'
        );
    });

    it('applies through a symlinked node_modules directory', () => {
        const packageRoot = fixture(ORIGINAL);
        const checkout = fs.mkdtempSync(
            path.join(os.tmpdir(), 'ccstatusline-patch-checkout-')
        );
        temporaryRoots.push(checkout);
        fs.symlinkSync(path.join(packageRoot, 'node_modules'), path.join(checkout, 'node_modules'));

        expect(applyInstallPatches(checkout, PATCH)).toBe('applied');
        expect(applyInstallPatches(checkout, PATCH)).toBe('present');
    });
});
