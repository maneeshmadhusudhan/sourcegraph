import { createOrUpdateNotebook } from './createOrUpdateNotebook'
import { Permutations } from './types'

import { readFileSync } from 'fs'
import { createPermutations } from './createPermutations'

let notebookMap: { [packageA: string]: { [packageB: string]: string } } = {}
try {
    notebookMap = JSON.parse(readFileSync('db/notebooks.json', 'utf8').toString() || '{}')
} catch {}

;(async function () {
    const permutations: Permutations = createPermutations()

    for (const [packageA, set] of permutations) {
        for (const packageB of set) {
            let notebookId: string | null = notebookMap[packageA]?.[packageB] ?? null

            notebookId = await createOrUpdateNotebook(notebookId, packageA, packageB)

            if (notebookMap[packageA] == null) {
                notebookMap[packageA] = {}
            }
            notebookMap[packageA][packageB] = notebookId

            throw new Error('sdf')

            // writeFileSync('db/notebooks.json', JSON.stringify(notebookMap, null, 2))
        }
    }
})()
