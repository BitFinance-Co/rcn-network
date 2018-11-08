module.exports = {
    norpc: true,
    testCommand: 'node --max-old-space-size=4096 ../node_modules/.bin/truffle test --network coverage',
    compileCommand: 'node --max-old-space-size=4096 ../node_modules/.bin/truffle compile --network coverage',
    skipFiles: [ // TODO: Remove skip BytesUtils when solidity-coverage gets patched
        'utils/BytesUtils.sol',
        'diaspore/utils/test',
        'utils/test'
    ]
}