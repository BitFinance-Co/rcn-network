const TestModel = artifacts.require('./diaspore/utils/test/TestModel.sol');
const DebtEngine = artifacts.require('./diaspore/DebtEngine.sol');
const TestToken = artifacts.require('./utils/test/TestToken.sol');
const TestOracle = artifacts.require('./utils/test/TestOracle.sol');
const OracleAdapter = artifacts.require('./diaspore/utils/OracleAdapter.sol');
const TestRateOracle = artifacts.require('./diaspore/utils/test/TestRateOracle.sol');

const Helper = require('../Helper.js');

const BN = web3.utils.BN;

function bn (number) {
    return new BN(number);
}

function toWei (stringNumber) {
    return bn(stringNumber).mul(bn('10').pow(bn('18')));
}

contract('Test DebtEngine Diaspore', function (accounts) {
    let rcn;
    let debtEngine;
    let testModel;
    let legacyOracle;
    let oracle;
    let testOracle;

    async function getId (promise) {
        const receipt = await promise;
        const event = receipt.logs.find(l => l.event === 'Created2' || l.event === 'Created3' || l.event === 'Created');
        return event.args._id;
    }

    before('Create engine and model', async function () {
        rcn = await TestToken.new();
        debtEngine = await DebtEngine.new(rcn.address);
        testModel = await TestModel.new();
        testOracle = await TestRateOracle.new();
        await testModel.setEngine(debtEngine.address);
        legacyOracle = await TestOracle.new();
        oracle = await OracleAdapter.new(
            legacyOracle.address,
            'ARS',
            'Argentine Peso',
            'Test oracle, ripiocredit.network',
            bn('2'),
            '0x415253',
            rcn.address
        );
    });

    describe('Constructor', function () {
        it('Creation should fail if token is not a contract', async function () {
            await Helper.tryCatchRevert(
                () => DebtEngine.new(
                    accounts[2]
                ),
                'Token should be a contract'
            );
        });
    });

    it('Should generate diferents ids create and create2', async function () {
        const id1 = await getId(debtEngine.create(
            testModel.address,
            accounts[0],
            Helper.address0x,
            await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
        ));
        const id2 = await getId(debtEngine.create2(
            testModel.address,
            accounts[0],
            Helper.address0x,
            await debtEngine.nonces(accounts[0]),
            await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
        ));
        assert.notEqual(id1, id2);
    });

    it('Should create different ids create2 and create3', async function () {
        const expireTime = (await Helper.getBlockTime()) + 2000;
        const id1 = await getId(debtEngine.create2(
            testModel.address,
            accounts[0],
            Helper.address0x,
            bn('89999'),
            await testModel.encodeData(bn('1001'), expireTime)
        ));

        const id2 = await getId(debtEngine.create3(
            testModel.address,
            accounts[0],
            Helper.address0x,
            bn('89999'),
            await testModel.encodeData(bn('1001'), expireTime)
        ));

        assert.notEqual(id1, id2);
    });

    describe('Function create', function () {
        it('Should create a debt using create', async function () {
            const owner = accounts[1];
            const creator = accounts[2];
            const nonce = await debtEngine.nonces(creator);
            const data = await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 1000);
            const calcId = await debtEngine.buildId(
                creator,
                nonce
            );
            const prevBalAcc1 = await debtEngine.balanceOf(accounts[1]);

            const Created = await Helper.toEvents(
                debtEngine.create(
                    testModel.address,
                    owner,
                    Helper.address0x,
                    data,
                    { from: creator }
                ),
                'Created'
            );

            assert.equal(Created._id, calcId);
            assert.equal(Created._nonce, nonce.toString());
            assert.equal(Created._data, data);

            // Check Debt
            const debt = await debtEngine.debts(calcId);
            assert.equal(debt.error, false);
            assert.equal(debt.balance, '0');
            assert.equal(debt.model, testModel.address);
            assert.equal(debt.creator, creator);
            assert.equal(debt.oracle, Helper.address0x);

            assert.equal(await debtEngine.ownerOf(calcId), owner);
            assert.equal(
                await debtEngine.balanceOf(accounts[1]), prevBalAcc1.add(bn('1')).toString(),
                'Account 1 should have a new asset'
            );
        });

        it('Differents debt engine should give differents ids, create', async function () {
            const engine1 = await DebtEngine.new(rcn.address);
            const engine2 = await DebtEngine.new(rcn.address);

            await testModel.setEngine(engine1.address);

            const id1 = await getId(engine1.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setEngine(engine2.address);

            const id2 = await getId(engine2.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setEngine(debtEngine.address);

            assert.notEqual(id1, id2);
        });

        it('Should fail to create if model returned false', async function () {
            await testModel.setGlobalErrorFlag(bn('8'));

            const data = await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 1000);

            await Helper.tryCatchRevert(
                () => debtEngine.create(
                    testModel.address,
                    accounts[1],
                    Helper.address0x,
                    data
                ),
                'Error creating debt in model'
            );

            await testModel.setGlobalErrorFlag('0');
        });
    });

    describe('Function create2', function () {
        it('Should create a debt using create2', async function () {
            const owner = accounts[1];
            const creator = accounts[2];
            const salt = bn('1283712983789');
            const data = await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000);
            const calcId = await debtEngine.buildId2(
                creator,
                testModel.address,
                Helper.address0x,
                salt,
                data
            );
            const prevBalAcc1 = await debtEngine.balanceOf(accounts[1]);

            const Created2 = await Helper.toEvents(
                debtEngine.create2(
                    testModel.address,
                    owner,
                    Helper.address0x,
                    salt,
                    data,
                    { from: creator }
                ),
                'Created2'
            );

            assert.equal(Created2._id, calcId);
            assert.equal(Created2._salt, salt.toString());
            assert.equal(Created2._data, data);

            // Check Debt
            const debt = await debtEngine.debts(calcId);
            assert.equal(debt.error, false);
            assert.equal(debt.balance, '0');
            assert.equal(debt.model, testModel.address);
            assert.equal(debt.creator, creator);
            assert.equal(debt.oracle, Helper.address0x);

            assert.equal(await debtEngine.ownerOf(calcId), owner);
            assert.equal(
                await debtEngine.balanceOf(accounts[1]), prevBalAcc1.add(bn('1')).toString(),
                'Account 1 should have a new asset'
            );
        });

        it('Should create 2 debts using create2', async function () {
            const prevBalAcc1 = await debtEngine.balanceOf(accounts[1]);
            const prevBalAcc2 = await debtEngine.balanceOf(accounts[2]);

            await debtEngine.create2(
                testModel.address,
                accounts[1],
                Helper.address0x,
                bn('8000000'),
                await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000)
            );

            assert.equal(
                await debtEngine.balanceOf(accounts[1]), prevBalAcc1.add(bn('1')).toString(),
                'Account 1 should have a new asset'
            );

            await debtEngine.create2(
                testModel.address,
                accounts[2],
                Helper.address0x,
                bn('8000001'),
                await testModel.encodeData(bn('2000'), (await Helper.getBlockTime()) + 3000)
            );

            assert.equal(
                await debtEngine.balanceOf(accounts[2]), prevBalAcc2.add(bn('1')).toString(),
                'Account 2 should have a new asset'
            );
        });

        it('Should predict Ids', async function () {
            const pid1 = await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                Helper.address0x,
                bn('12000'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            );

            const id1 = await getId(debtEngine.create2(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('12000'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            assert.equal(pid1, id1);

            const pid2 = await debtEngine.buildId(
                accounts[0],
                await debtEngine.nonces(accounts[0])
            );

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            assert.equal(pid2, id2);
        });

        it('Differents debt engine should give differents ids, create2', async function () {
            const engine1 = await DebtEngine.new(rcn.address);
            const engine2 = await DebtEngine.new(rcn.address);

            await testModel.setEngine(engine1.address);

            const id1 = await getId(engine1.create2(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('768484844'),
                await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setEngine(engine2.address);

            const id2 = await getId(engine2.create2(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('768484844'),
                await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setEngine(debtEngine.address);

            assert.notEqual(id1, id2);
        });

        it('Should fail to create2 if model returned false', async function () {
            await testModel.setGlobalErrorFlag(bn('8'));

            const data = await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 1000);

            await Helper.tryCatchRevert(
                () => debtEngine.create2(
                    testModel.address,
                    accounts[1],
                    Helper.address0x,
                    bn('9489342'),
                    data
                ),
                'Error creating debt in model'
            );

            await testModel.setGlobalErrorFlag('0');
        });

        it('Should fail to create2 with the same nonce', async function () {
            const expireTime = (await Helper.getBlockTime()) + 2000;
            await debtEngine.create2(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('9999'),
                await testModel.encodeData(bn('1000'), expireTime)
            );

            const data = await testModel.encodeData(bn('1000'), expireTime);

            await Helper.tryCatchRevert(
                () => debtEngine.create2(
                    testModel.address,
                    accounts[0],
                    Helper.address0x,
                    bn('9999'),
                    data
                ),
                'Asset already exists'
            );
        });
    });

    describe('Function create3', function () {
        it('Should create a debt using create3', async function () {
            const owner = accounts[1];
            const creator = accounts[2];
            const salt = bn('1283712983789');
            const data = await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000);
            const calcId = await debtEngine.buildId3(
                creator,
                salt
            );
            const prevBalAcc1 = await debtEngine.balanceOf(accounts[1]);

            const Created3 = await Helper.toEvents(
                debtEngine.create3(
                    testModel.address,
                    owner,
                    Helper.address0x,
                    salt,
                    data,
                    { from: creator }
                ),
                'Created3'
            );

            assert.equal(Created3._id, calcId);
            assert.equal(Created3._salt, salt.toString());
            assert.equal(Created3._data, data);

            // Check Debt
            const debt = await debtEngine.debts(calcId);
            assert.equal(debt.error, false);
            assert.equal(debt.balance, '0');
            assert.equal(debt.model, testModel.address);
            assert.equal(debt.creator, creator);
            assert.equal(debt.oracle, Helper.address0x);

            assert.equal(await debtEngine.ownerOf(calcId), owner);
            assert.equal(
                await debtEngine.balanceOf(accounts[1]), prevBalAcc1.add(bn('1')).toString(),
                'Account 1 should have a new asset'
            );
        });

        it('Differents debt engine should give differents ids, create3', async function () {
            const engine1 = await DebtEngine.new(rcn.address);
            const engine2 = await DebtEngine.new(rcn.address);

            await testModel.setEngine(engine1.address);

            const id1 = await getId(engine1.create3(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('768484844'),
                await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setEngine(engine2.address);

            const id2 = await getId(engine2.create3(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('768484844'),
                await testModel.encodeData(bn('3000'), (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setEngine(debtEngine.address);

            assert.notEqual(id1, id2);
        });

        it('Try withdrawBatch funds to 0x0 address', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 10000);

            await rcn.approve(debtEngine.address, 10000);
            await debtEngine.pay(id, 4000, accounts[3], []);

            await Helper.tryCatchRevert(
                () => debtEngine.withdrawBatch(
                    [id],
                    Helper.address0x
                ),
                '_to should not be 0x0'
            );
        });

        it('Try withdraw funds to 0x0 address', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 10000);

            await rcn.approve(debtEngine.address, 10000);
            await debtEngine.pay(id, 4000, accounts[3], []);

            await Helper.tryCatchRevert(
                () => debtEngine.withdraw(
                    id,
                    Helper.address0x
                ),
                '_to should not be 0x0'
            );
        });

        it('Try withdrawPartial funds to 0x0 address', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 10000);

            await rcn.approve(debtEngine.address, 10000);
            await debtEngine.pay(id, 4000, accounts[3], []);

            await Helper.tryCatchRevert(
                () => debtEngine.withdrawPartial(
                    id,
                    Helper.address0x,
                    '1'
                ),
                '_to should not be 0x0'
            );
        });

        it('Should predict id create 3', async function () {
            const pid = await debtEngine.buildId3(
                accounts[0],
                bn('12200')
            );

            const id = await getId(debtEngine.create3(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('12200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            assert.equal(pid, id);
        });

        it('Should fail to create3 if model returned false', async function () {
            await testModel.setGlobalErrorFlag(bn('8'));

            const data = await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 1000);

            await Helper.tryCatchRevert(
                () => debtEngine.create3(
                    testModel.address,
                    accounts[1],
                    Helper.address0x,
                    bn('948934233'),
                    data
                ),
                'Error creating debt in model'
            );

            await testModel.setGlobalErrorFlag('0');
        });

        it('Should fail to create3 with the same nonce', async function () {
            const expireTime = (await Helper.getBlockTime()) + 2000;

            await debtEngine.create3(
                testModel.address,
                accounts[0],
                Helper.address0x,
                bn('79999'),
                await testModel.encodeData(bn('1200'), expireTime)
            );

            const data = await testModel.encodeData(bn('1000'), expireTime);

            await Helper.tryCatchRevert(
                () => debtEngine.create3(
                    testModel.address,
                    accounts[0],
                    Helper.address0x,
                    bn('79999'),
                    data
                ),
                'Asset already exists'
            );
        });
    });

    describe('Function buildId2', function () {
        it('It should create diferent IDs create2 with any change', async function () {
            const ids = [];

            ids.push(await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                Helper.address0x,
                bn('1200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[1],
                testModel.address,
                Helper.address0x,
                bn('1200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[0],
                accounts[3],
                Helper.address0x,
                bn('1200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                accounts[3],
                bn('1200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                Helper.address0x,
                bn('1200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2200)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                Helper.address0x,
                bn('1200'),
                await testModel.encodeData(bn('1001'), (await Helper.getBlockTime()) + 2000)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                Helper.address0x,
                bn('1201'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                Helper.address0x,
                bn('1200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2001)
            ));

            ids.push(await debtEngine.buildId2(
                accounts[0],
                testModel.address,
                accounts[9],
                bn('2200'),
                await testModel.encodeData(bn('1000'), (await Helper.getBlockTime()) + 2000)
            ));

            assert.equal(new Set(ids).size, 9);
        });
    });

    describe('Function pay', function () {
        it('Should create and pay a debt', async function () {
            const owner = accounts[1];
            const payer = accounts[2];
            const originPayer = accounts[3];
            const oracle = Helper.address0x;
            const amount = bn('3000');
            const data = await testModel.encodeData(amount, (await Helper.getBlockTime()) + 2000);

            const id = await getId(debtEngine.create(
                testModel.address,
                owner,
                oracle,
                data
            ));

            const plusAmount = bn('561321');
            await rcn.setBalance(payer, amount.add(plusAmount));
            await rcn.approve(debtEngine.address, amount.add(plusAmount), { from: payer });

            const Paid = await Helper.toEvents(
                debtEngine.pay(
                    id,
                    amount,
                    originPayer,
                    [],
                    { from: payer }
                ),
                'Paid'
            );

            assert.equal(Paid._id, id);
            assert.equal(Paid._sender, payer);
            assert.equal(Paid._origin, originPayer);
            assert.equal(Paid._requested, amount.toString());
            assert.equal(Paid._requestedTokens, '0');
            assert.equal(Paid._paid, amount.toString());
            assert.equal(Paid._tokens, amount.toString());

            const debt = await debtEngine.debts(id);
            assert.equal(debt.balance, amount.toString());

            assert.equal(await rcn.balanceOf(payer), plusAmount.toString());
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_PAID);
            assert.equal(await testModel.getPaid(id), amount.toString());
        });

        it('Should pay using an Oracle', async function () {
            const owner = accounts[1];
            const payer = accounts[2];
            const originPayer = accounts[3];
            const payAmountOracle = bn('60000');
            const data = await testModel.encodeData(bn('10000'), (await Helper.getBlockTime()) + 2000);

            const id = await getId(debtEngine.create(
                testModel.address,
                owner,
                oracle.address,
                data
            ));

            // 1 ETH WEI = 6000 RCN WEI
            const oracleTokens = bn('6000');
            const oracleEquivalent = bn('1');
            const _paid = payAmountOracle.mul(oracleEquivalent).div(oracleTokens);

            const payAmountToken = _paid.mul(oracleTokens).div(oracleEquivalent);
            const dummyData1 = await legacyOracle.dummyData1();

            await rcn.setBalance(payer, payAmountToken);
            await rcn.approve(debtEngine.address, payAmountToken, { from: payer });

            const payEvents = await Helper.toEvents(
                debtEngine.pay(
                    id,
                    bn('10'),
                    originPayer,
                    dummyData1,
                    { from: payer }
                ),
                'Paid',
                'ReadedOracle'
            );

            const Paid = payEvents[0];
            assert.equal(Paid._id, id);
            assert.equal(Paid._sender, payer);
            assert.equal(Paid._origin, originPayer);
            assert.equal(Paid._requested, '10');
            assert.equal(Paid._requestedTokens.toString(), '0');
            assert.equal(Paid._paid.toString(), _paid.toString());
            assert.equal(Paid._tokens.toString(), payAmountToken.toString());

            const ReadedOracle = payEvents[1];
            assert.equal(ReadedOracle._id, id);
            assert.equal(ReadedOracle._tokens, oracleTokens.toString());
            assert.equal(ReadedOracle._equivalent, oracleEquivalent.toString());

            const debt = await debtEngine.debts(id);
            assert.equal(debt.balance.toString(), payAmountOracle.toString());

            assert.equal(await rcn.balanceOf(payer), '0');
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), _paid.toString());

            const dummyData2 = await legacyOracle.dummyData2();

            assert.equal(await rcn.balanceOf(accounts[2]), '0');
            assert.equal(await testModel.getPaid(id), '10');

            await rcn.approve(debtEngine.address, 500, { from: accounts[3] });
            await rcn.setBalance(accounts[3], 500);
            await debtEngine.pay(id, 1000, Helper.address0x, dummyData2, { from: accounts[3] });

            assert.equal(await rcn.balanceOf(accounts[3]), 0);
            assert.equal(await testModel.getPaid(id), 1010);

            await rcn.approve(debtEngine.address, 6000, { from: accounts[3] });
            await rcn.setBalance(accounts[3], 10000);
            await debtEngine.pay(id, 10000, accounts[0], dummyData2, { from: accounts[3] });

            assert.equal((await rcn.balanceOf(accounts[3])).toNumber(), 10000 - (10000 - 1010) / 2);
            assert.equal(await testModel.getPaid(id), 10000);
            assert.equal(await debtEngine.getStatus(id), 2);
        });

        it('Pay should round in favor of the owner', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            // 2 ETH = 1 RCN
            const data = await testOracle.encodeRate(1, 2);

            await rcn.setBalance(accounts[0], 0);
            await rcn.approve(debtEngine.address, 0);

            await Helper.assertThrow(debtEngine.pay(id, 1, Helper.address0x, data));

            assert.equal(await testModel.getPaid(id), 0);
        });

        it('Should apply rate even when tokens is not divisible by 10', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            // 0.82711175222132156792 ETH = 4000.23333566612312 RCN
            const data = await testOracle.encodeRate(bn('400023333566612312000000'), bn('82711175222132156792'));

            await rcn.setBalance(accounts[0], 4836388);
            await rcn.approve(debtEngine.address, 4836388);

            await debtEngine.pay(id, 1000, Helper.address0x, data);

            assert.equal(await rcn.balanceOf(accounts[0]), '0');
        });

        it('Should apply rate with token more expensive than currency', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            // 1.22 RCN = 22.94 ETH :)
            const data = await testOracle.encodeRate(122, 2294);

            await rcn.setBalance(accounts[0], '53182214472537054');
            await rcn.approve(debtEngine.address, '53182214472537054');

            await debtEngine.pay(id, toWei(1), Helper.address0x, data);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
        });

        it('Pay should fail if paid is more than requested', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 10000);
            await rcn.approve(debtEngine.address, 10000);

            const prevBalance = await rcn.balanceOf(accounts[0]);

            await testModel.setErrorFlag(id, 9);

            await Helper.assertThrow(debtEngine.pay(id, 100, Helper.address0x, Helper.address0x));

            assert.equal(await testModel.getPaid(id), 0);
            assert.equal((await rcn.balanceOf(accounts[0])).toNumber(), prevBalance.toNumber());
        });

        it('Pay should fail if rate includes zero', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            let data = await testOracle.encodeRate(0, bn('82711175222132156792'));

            const value = bn('10').pow(bn('32'));
            await rcn.setBalance(accounts[0], value);
            await rcn.approve(debtEngine.address, value);

            await Helper.assertThrow(debtEngine.pay(id, 1000, Helper.address0x, data));

            assert.equal(await rcn.balanceOf(accounts[0]), value.toString());
            assert.equal(await testModel.getPaid(id), 0);

            data = await testOracle.encodeRate(14123, 0);

            await Helper.assertThrow(debtEngine.pay(id, 1000, Helper.address0x, data));

            assert.equal(await rcn.balanceOf(accounts[0]), value.toString());
            assert.equal(await testModel.getPaid(id), 0);
        });

        it('Pay should fail if payer has not enought balance', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);

            await Helper.assertThrow(debtEngine.pay(id, 2000, Helper.address0x, Helper.address0x));

            assert.equal(await testModel.getPaid(id), 0);
        });

        it('Should catch and recover from a pay error', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 50, accounts[3], []);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 1);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.pay(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 100);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.pay(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Should catch and recover from a pay infinite loop', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 50, accounts[3], []);

            assert.equal(await rcn.balanceOf(accounts[0]), '0');
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), '50');

            // Set the error flag
            await testModel.setErrorFlag(id, '2');

            // Try to pay
            await rcn.setBalance(accounts[0], '100');

            await rcn.approve(debtEngine.address, '100');
            await debtEngine.pay(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 100);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.pay(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Should catch and recover from a pay error, with an Oracle', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData2 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 25);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 50, accounts[3], dummyData2);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 1);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 100, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 50);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 100, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });
    });

    describe('Function payToken', function () {
        it('Should create and pay a debt using payToken', async function () {
            const owner = accounts[1];
            const payer = accounts[2];
            const originPayer = accounts[3];
            const oracle = Helper.address0x;
            const amount = bn('3000');
            const data = await testModel.encodeData(amount, (await Helper.getBlockTime()) + 2000);

            const id = await getId(debtEngine.create(
                testModel.address,
                owner,
                oracle,
                data
            ));

            const plusAmount = bn('561321');
            await rcn.setBalance(payer, amount.add(plusAmount));
            await rcn.approve(debtEngine.address, amount.add(plusAmount), { from: payer });

            const Paid = await Helper.toEvents(
                debtEngine.payToken(
                    id,
                    amount,
                    originPayer,
                    [],
                    { from: payer }
                ),
                'Paid'
            );
            assert.equal(Paid._id, id);
            assert.equal(Paid._sender, payer);
            assert.equal(Paid._origin, originPayer);
            assert.equal(Paid._requested, '0');
            assert.equal(Paid._requestedTokens, amount.toString());
            assert.equal(Paid._paid, amount.toString());
            assert.equal(Paid._tokens, amount.toString());

            const debt = await debtEngine.debts(id);
            assert.equal(debt.balance, amount.toString());

            assert.equal(await rcn.balanceOf(payer), plusAmount.toString());
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_PAID);
            assert.equal(await testModel.getPaid(id), amount.toString());
        });

        it('Should payToken using an Oracle', async function () {
            const owner = accounts[1];
            const payer = accounts[2];
            const originPayer = accounts[3];
            const payAmountOracle = bn('60000');
            const data = await testModel.encodeData(bn('10000'), (await Helper.getBlockTime()) + 2000);

            const id = await getId(debtEngine.create(
                testModel.address,
                owner,
                oracle.address,
                data
            ));

            // 1 ETH WEI = 6000 RCN WEI
            const oracleTokens = bn('6000');
            const oracleEquivalent = bn('1');
            const _paid = payAmountOracle.mul(oracleEquivalent).div(oracleTokens);
            const payAmountToken = _paid.mul(oracleTokens).div(oracleEquivalent);
            const dummyData1 = await legacyOracle.dummyData1();

            await rcn.setBalance(payer, payAmountToken);
            await rcn.approve(debtEngine.address, payAmountToken, { from: payer });

            const payTokenEvents = await Helper.toEvents(
                debtEngine.payToken(
                    id,
                    payAmountOracle,
                    originPayer,
                    dummyData1,
                    { from: payer }
                ),
                'Paid',
                'ReadedOracle'
            );

            const Paid = payTokenEvents[0];
            assert.equal(Paid._id, id);
            assert.equal(Paid._sender, payer);
            assert.equal(Paid._origin, originPayer);
            assert.equal(Paid._requested, '0');
            assert.equal(Paid._requestedTokens.toString(), payAmountOracle.toString());
            assert.equal(Paid._paid.toString(), _paid.toString());
            assert.equal(Paid._tokens.toString(), payAmountToken.toString());

            const ReadedOracle = payTokenEvents[1];
            assert.equal(ReadedOracle._id, id);
            assert.equal(ReadedOracle._tokens, oracleTokens.toString());
            assert.equal(ReadedOracle._equivalent, oracleEquivalent.toString());

            const debt = await debtEngine.debts(id);
            assert.equal(debt.balance.toString(), payAmountOracle.toString());

            assert.equal(await rcn.balanceOf(payer), '0');
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), _paid.toString());

            // payToken with dummyData2
            const payAmountOracle2 = bn('500');
            const oracleTokens2 = bn('5');
            const oracleEquivalent2 = bn('10');
            const _paid2 = payAmountOracle2.mul(oracleEquivalent2).div(oracleTokens2);
            const dummyData2 = await legacyOracle.dummyData2();

            await rcn.approve(debtEngine.address, payAmountOracle2, { from: payer });
            await rcn.setBalance(payer, payAmountOracle2);
            await debtEngine.payToken(
                id,
                payAmountOracle2,
                Helper.address0x,
                dummyData2,
                { from: payer }
            );

            assert.equal(await rcn.balanceOf(payer), '0');
            assert.equal(await testModel.getPaid(id), _paid.add(_paid2).toString());

            const payer2 = accounts[5];
            await rcn.setBalance(payer2, bn('10000'));
            await rcn.approve(debtEngine.address, bn('6000'), { from: payer2 });
            await debtEngine.payToken(
                id,
                bn('19000'),
                accounts[0],
                dummyData2,
                { from: payer2 }
            );

            assert.equal(await rcn.balanceOf(payer2), bn('10000').sub((bn('10000').sub(bn('1010'))).div(bn('2'))).toString());
            assert.equal(await testModel.getPaid(id), bn('10000').toString());
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_PAID);
        });

        it('Pay tokens round in favor of the owner', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            // 1 ETH = 2 RCN
            const data = await testOracle.encodeRate(2, 1);

            await rcn.setBalance(accounts[0], 1);
            await rcn.approve(debtEngine.address, 1);

            await debtEngine.payToken(id, 1, Helper.address0x, data);

            assert.equal(await testModel.getPaid(id), 0);
        });

        it('Should apply rate pay tokens even when tokens is not divisible by 10', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            // 2.82711175222132156792 ETH = 4010.23333566612312 RCN
            const data = await testOracle.encodeRate(bn('401023333566612312000000'), bn('282711175222132156792'));

            await rcn.setBalance(accounts[0], toWei(1));
            await rcn.approve(debtEngine.address, toWei(1));

            await debtEngine.payToken(id, toWei(1), Helper.address0x, data);

            assert.equal(await rcn.balanceOf(accounts[0]), bn('342').toString());
            assert.equal(await testModel.getPaid(id), '704974378193313');
        });

        it('Should apply rate pay tokens with token more expensive than currency', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            // 4.122224 RCN = 0.5 ETH :)
            const data = await testOracle.encodeRate(41222240, 5);

            await rcn.setBalance(accounts[0], toWei(2));
            await rcn.approve(debtEngine.address, toWei(2));

            await debtEngine.payToken(id, toWei(2), Helper.address0x, data);

            assert.equal(await rcn.balanceOf(accounts[0]), 1834816);
            assert.equal(await testModel.getPaid(id), bn('242587496458').toString());
        });

        it('Should catch and recover from a payToken infinite loop', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 50, accounts[3], []);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 2);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.payToken(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 100);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.payToken(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Should catch and recover from a payToken infinite loop, with an Oracle', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData2 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 25);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 25, accounts[3], dummyData2);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 2);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 50, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 50);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 50, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Should catch and recover from a payToken error, with an Oracle', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData2 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 25);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 25, accounts[3], dummyData2);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 1);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 50, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 50);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 50, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Should catch and recover from a payToken error', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.payToken(id, 50, accounts[3], []);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 1);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.payToken(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 100);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.payToken(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Pay tokens should fail if paid is more than requested', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 10000);
            await rcn.approve(debtEngine.address, 10000);

            const prevBalance = await rcn.balanceOf(accounts[0]);

            await testModel.setErrorFlag(id, 9);

            await Helper.assertThrow(debtEngine.payToken(id, 100, Helper.address0x, Helper.address0x));

            assert.equal(await testModel.getPaid(id), 0);
            assert.equal((await rcn.balanceOf(accounts[0])).toNumber(), prevBalance.toNumber());
        });

        it('Pay tokens should fail if payer has not enought balance', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);

            await Helper.assertThrow(debtEngine.payToken(id, 2000, Helper.address0x, Helper.address0x));

            assert.equal(await testModel.getPaid(id), 0);
        });

        it('Pay tokens fail if rate includes zero', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            let data = await testOracle.encodeRate(0, bn('82711175222132156792'));

            const value = bn('10').pow(bn('32'));
            await rcn.setBalance(accounts[0], value);
            await rcn.approve(debtEngine.address, value);

            await Helper.assertThrow(debtEngine.payToken(id, 1000, Helper.address0x, data));

            assert.equal(await rcn.balanceOf(accounts[0]), value.toString());
            assert.equal(await testModel.getPaid(id), 0);

            data = await testOracle.encodeRate(14123, 0);

            await Helper.assertThrow(debtEngine.payToken(id, 1000, Helper.address0x, data));

            assert.equal(await rcn.balanceOf(accounts[0]), value.toString());
            assert.equal(await testModel.getPaid(id), 0);
        });
    });

    describe('Function payBatch', function () {
        it('Should fail because are different size input arrays)', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));
            await Helper.assertThrow(
                debtEngine.payBatch(
                    [id],
                    [10, 20],
                    accounts[1],
                    oracle.address,
                    Helper.address0x,
                    { from: accounts[2] }
                )
            );
            await Helper.assertThrow(
                debtEngine.payBatch(
                    [id, id],
                    [10],
                    accounts[1],
                    oracle.address,
                    Helper.address0x,
                    { from: accounts[2] }
                )
            );
        });

        it('Pay 0 loans should make no change', async function () {
            await rcn.setBalance(accounts[2], 0);
            await debtEngine.payBatch(
                [],
                [],
                accounts[1],
                Helper.address0x,
                Helper.address0x,
                { from: accounts[2] }
            );
        });

        it('Pay batch should emit pay event', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[4],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const data = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 1500);
            await rcn.approve(debtEngine.address, 1500);

            const receipt = await debtEngine.payBatch([id1, id2], [2000, 1000], accounts[4], oracle.address, data);

            // Test read oracle event
            const oracleEvent = receipt.logs.find((l) => l.event === 'ReadedOracleBatch');
            assert.isOk(oracleEvent);
            assert.equal(oracleEvent.args._count, 2);
            assert.equal(oracleEvent.args._tokens, 5);
            assert.equal(oracleEvent.args._equivalent, 10);

            // Test paid events
            const paidLogs = receipt.logs.filter((l) => l.event === 'Paid');
            assert.equal(paidLogs.length, 2);
            assert.equal(paidLogs.filter((e) => e.args._id === id1).length, 1);
            assert.equal(paidLogs.filter((e) => e.args._id === id2).length, 1);
            paidLogs.forEach((event) => {
                switch (event.args._id) {
                case id1:
                    const args = event.args;
                    assert.equal(args._requested, 2000);
                    assert.equal(args._requestedTokens, 0);
                    assert.equal(args._paid, 2000);
                    assert.equal(args._tokens, 1000);
                    assert.equal(args._sender, accounts[0]);
                    assert.equal(args._origin, accounts[4]);
                    break;
                case id2:
                    const args2 = event.args;
                    assert.equal(args2._requested, 1000);
                    assert.equal(args2._requestedTokens, 0);
                    assert.equal(args2._paid, 1000);
                    assert.equal(args2._tokens, 500);
                    assert.equal(args2._sender, accounts[0]);
                    assert.equal(args2._origin, accounts[4]);
                    break;
                }
            });
        });

        it('Pay batch multiple times multiple id should be like paying the sum', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.payBatch([id1, id1, id2], [1000, 1000, 500], Helper.address0x, Helper.address0x, []);

            assert.equal(await rcn.balanceOf(accounts[0]), 500);
            assert.equal(await testModel.getPaid(id1), 2000);
            assert.equal(await testModel.getPaid(id2), 500);

            const debt1 = await debtEngine.debts(id1);
            assert.equal(debt1[1], 2000);

            const debt2 = await debtEngine.debts(id2);
            assert.equal(debt2[1], 500);
        });

        it('Should create and pay debts in batch', async function () {
            const ids = [];
            ids[0] = await getId(
                debtEngine.create(
                    testModel.address, // model
                    accounts[2],       // owner
                    Helper.address0x,               // oracle
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000) // data
                )
            );
            ids[1] = await getId(
                debtEngine.create(
                    testModel.address, // model
                    accounts[2],       // owner
                    Helper.address0x,               // oracle
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000) // data
                )
            );
            ids[2] = await getId(
                debtEngine.create(
                    testModel.address, // model
                    accounts[2],       // owner
                    Helper.address0x,               // oracle
                    await testModel.encodeData(100, (await Helper.getBlockTime()) + 2000) // data
                )
            );

            const amounts = [4000, 3000, 150];

            await rcn.setBalance(accounts[0], 7150);
            await rcn.approve(debtEngine.address, 7150);

            await debtEngine.payBatch(ids, amounts, Helper.address0x, Helper.address0x, []);

            assert.equal(await rcn.balanceOf(accounts[0]), 1050);
            assert.equal(await debtEngine.getStatus(ids[0]), 2);
            assert.equal(await testModel.getPaid(ids[0]), 3000);
        });

        it('Should pay batch using a oracle', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                oracle.address,
                await testModel.encodeData(10000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData1 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[2], 500);
            await rcn.approve(debtEngine.address, 500, { from: accounts[2] });

            await debtEngine.payBatch([id], [1000], accounts[1], oracle.address, dummyData1, { from: accounts[2] });

            assert.equal(await rcn.balanceOf(accounts[2]), 0);
            assert.equal(await testModel.getPaid(id), 1000);
        });

        it('Pay batch should round in favor of the owner', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            // 2 ETH = 1 RCN
            const data = await testOracle.encodeRate(1, 2);

            await rcn.setBalance(accounts[0], 0);
            await rcn.approve(debtEngine.address, 0);

            await Helper.assertThrow(debtEngine.payBatch([id, id], [1, 0], Helper.address0x, testOracle.address, data));
            await Helper.assertThrow(debtEngine.payBatch([id], [1], Helper.address0x, testOracle.address, data));
            await debtEngine.payBatch([id], [0], Helper.address0x, testOracle.address, data);

            assert.equal(await testModel.getPaid(id), 0);
        });

        it('Should apply rate pay batch with token more expensive than currency', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            // 1.22 RCN = 22.94 ETH :)
            const data = await testOracle.encodeRate(122, 2294);

            await rcn.setBalance(accounts[0], '53182214472537054');
            await rcn.approve(debtEngine.address, toWei(1));

            await debtEngine.payBatch([id], [toWei(1)], Helper.address0x, testOracle.address, data);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
        });

        it('Pay batch should fail if one debt paid is more than requested', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 10000);
            await rcn.approve(debtEngine.address, 10000);

            const prevBalance = await rcn.balanceOf(accounts[0]);

            await testModel.setErrorFlag(id1, 9);

            await Helper.assertThrow(debtEngine.payBatch([id1, id2], [1000, 1000], Helper.address0x, Helper.address0x, []));

            assert.equal(await testModel.getPaid(id1), 0);
            assert.equal(await testModel.getPaid(id2), 0);
            assert.equal((await rcn.balanceOf(accounts[0])).toNumber(), prevBalance.toNumber());
        });

        it('Pay batch should fail if payer has balance for zero payments', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 500);
            await rcn.approve(debtEngine.address, 500);

            await Helper.assertThrow(debtEngine.payBatch([id1, id2], [1000, 1000], Helper.address0x, Helper.address0x, []));

            assert.equal(await testModel.getPaid(id1), 0);
            assert.equal(await testModel.getPaid(id2), 0);
        });

        it('Pay batch should fail if payer has balance below total', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1500);
            await rcn.approve(debtEngine.address, 1500);

            await Helper.assertThrow(debtEngine.payBatch([id1, id2], [1000, 1000], Helper.address0x, Helper.address0x, []));

            assert.equal(await testModel.getPaid(id1), 0);
            assert.equal(await testModel.getPaid(id2), 0);
        });

        it('Should pay batch with tokens less expensive than currency', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[4],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const data = await legacyOracle.dummyData3();

            await rcn.setBalance(accounts[0], 6000);
            await rcn.approve(debtEngine.address, 6000);

            await debtEngine.payBatch([id1, id2], [2000, 1000], accounts[4], oracle.address, data);

            assert.equal(await testModel.getPaid(id1), 2000);
            assert.equal(await testModel.getPaid(id2), 1000);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
        });

        it('Should pay batch with tokens more expensive than currency', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[4],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const data = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 1500);
            await rcn.approve(debtEngine.address, 1500);

            await debtEngine.payBatch([id1, id2], [2000, 1000], accounts[4], oracle.address, data);

            assert.equal(await testModel.getPaid(id1), 2000);
            assert.equal(await testModel.getPaid(id2), 1000);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
        });

        it('Should create and pay a debts using payTokens in batch', async function () {
            const ids = [];
            ids[0] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[1] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[2] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(100, (await Helper.getBlockTime()) + 2000)
                )
            );

            const amounts = [4000, 3000, 150];

            await rcn.setBalance(accounts[0], 7150);
            await rcn.approve(debtEngine.address, 7150);

            await debtEngine.payTokenBatch(ids, amounts, Helper.address0x, Helper.address0x, []);

            assert.equal(await rcn.balanceOf(accounts[0]), 1050);
            assert.equal(await debtEngine.getStatus(ids[0]), 2);
            assert.equal(await testModel.getPaid(ids[0]), 3000);
        });
    });

    describe('Function payTokenBatch', function () {
        it('Should fail because are different size input arrays)', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));
            await Helper.assertThrow(
                debtEngine.payTokenBatch(
                    [id],
                    [10, 20],
                    accounts[1],
                    oracle.address,
                    Helper.address0x,
                    { from: accounts[2] }
                )
            );
            await Helper.assertThrow(
                debtEngine.payTokenBatch(
                    [id, id],
                    [10],
                    accounts[1],
                    oracle.address,
                    Helper.address0x,
                    { from: accounts[2] }
                )
            );
        });

        it('Pay token batch shoud not overflow the debt balance', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setErrorFlag(id, 10);

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.pay(id, 3000, Helper.address0x, Helper.address0x);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 3000);

            const value = bn('2').pow(bn('129'));
            await rcn.setBalance(accounts[0], value);
            await rcn.approve(debtEngine.address, value);

            await Helper.assertThrow(debtEngine.payTokenBatch([id2, id], [10, value], Helper.address0x, Helper.address0x, []));

            assert.equal(await testModel.getPaid(id), 3000);
            assert.equal(await testModel.getPaid(id2), 0);

            const ndebt = await debtEngine.debts(id);
            assert.equal(ndebt[1], 3000);

            await rcn.setBalance(accounts[2], 0);
            await debtEngine.withdraw(id, accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
        });

        it('Pay tokens batch should fail if one debt paid is more than requested', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 10000);
            await rcn.approve(debtEngine.address, 10000);

            const prevBalance = await rcn.balanceOf(accounts[0]);

            await testModel.setErrorFlag(id2, 9);

            await Helper.assertThrow(debtEngine.payTokenBatch([id1, id2], [1000, 1000], Helper.address0x, Helper.address0x, []));

            assert.equal(await testModel.getPaid(id1), 0);
            assert.equal(await testModel.getPaid(id2), 0);
            assert.equal((await rcn.balanceOf(accounts[0])).toNumber(), prevBalance.toNumber());
        });

        it('Pay tokens batch should fail if payer has balance for zero payments', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 500);
            await rcn.approve(debtEngine.address, 500);

            await Helper.assertThrow(debtEngine.payTokenBatch([id1, id2], [1000, 1000], Helper.address0x, Helper.address0x, []));

            assert.equal(await testModel.getPaid(id1), 0);
            assert.equal(await testModel.getPaid(id2), 0);
        });

        it('Pay tokens batch should fail if payer has balance below total', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1500);
            await rcn.approve(debtEngine.address, 1500);

            await Helper.assertThrow(debtEngine.payTokenBatch([id1, id2], [1000, 1000], Helper.address0x, Helper.address0x, []));

            assert.equal(await testModel.getPaid(id1), 0);
            assert.equal(await testModel.getPaid(id2), 0);
        });

        it('Should create and pay a debts using payTokens in batch', async function () {
            const ids = [];
            ids[0] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[1] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[2] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(100, (await Helper.getBlockTime()) + 2000)
                )
            );

            const amounts = [4000, 3000, 150];

            await rcn.setBalance(accounts[0], 7150);
            await rcn.approve(debtEngine.address, 7150);

            await debtEngine.payTokenBatch(ids, amounts, Helper.address0x, Helper.address0x, []);

            assert.equal(await rcn.balanceOf(accounts[0]), 1050);
            assert.equal(await debtEngine.getStatus(ids[0]), 2);
            assert.equal(await testModel.getPaid(ids[0]), 3000);
        });

        it('Should pay tokens batch with tokens less expensive than currency', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[4],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const data = await legacyOracle.dummyData3();

            await rcn.setBalance(accounts[0], 6000);
            await rcn.approve(debtEngine.address, 6000);

            await debtEngine.payTokenBatch([id1, id2], [4000, 2000], accounts[4], oracle.address, data);

            assert.equal(await testModel.getPaid(id1), 2000);
            assert.equal(await testModel.getPaid(id2), 1000);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
        });

        it('Should pay tokens batch with tokens more expensive than currency', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[4],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const data = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 1500);
            await rcn.approve(debtEngine.address, 1500);

            await debtEngine.payTokenBatch([id1, id2], [1000, 500], accounts[4], oracle.address, data);

            assert.equal(await testModel.getPaid(id1), 2000);
            assert.equal(await testModel.getPaid(id2), 1000);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
        });

        it('Should pay token batch using a oracle', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                oracle.address,
                await testModel.encodeData(10000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData1 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[2], 500);
            await rcn.approve(debtEngine.address, 500, { from: accounts[2] });

            await debtEngine.payTokenBatch([id], [500], accounts[1], oracle.address, dummyData1, { from: accounts[2] });

            assert.equal(await rcn.balanceOf(accounts[2]), 0);
            assert.equal(await testModel.getPaid(id), 1000);
        });

        it('Should create and pay a debts using payTokens in batch', async function () {
            const ids = [];
            ids[0] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[1] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[2] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(100, (await Helper.getBlockTime()) + 2000)
                )
            );

            const amounts = [4000, 3000, 150];

            await rcn.setBalance(accounts[0], 7150);
            await rcn.approve(debtEngine.address, 7150);

            await debtEngine.payTokenBatch(ids, amounts, Helper.address0x, Helper.address0x, []);

            assert.equal(await rcn.balanceOf(accounts[0]), 1050);
            assert.equal(await debtEngine.getStatus(ids[0]), 2);
            assert.equal(await testModel.getPaid(ids[0]), 3000);
        });

        it('Pay tokens batch round in favor of the owner', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            // 1 ETH = 2 RCN
            const data = await testOracle.encodeRate(2, 1);

            await rcn.setBalance(accounts[0], 2);
            await rcn.approve(debtEngine.address, 2);

            await debtEngine.payTokenBatch([id, id], [1, 1], Helper.address0x, testOracle.address, data);

            assert.equal(await testModel.getPaid(id), 0);
        });

        it('Should not pay the third debt because not correspond the currency and oracle.', async function () {
            const ids = [];
            ids[0] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    Helper.address0x,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[1] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    oracle.address,
                    await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
                )
            );
            ids[2] = await getId(
                debtEngine.create(
                    testModel.address,
                    accounts[2],
                    oracle.address,
                    await testModel.encodeData(100, (await Helper.getBlockTime()) + 2000)
                )
            );

            const amounts = [4000, 3000, 150];

            await rcn.setBalance(accounts[0], 7150);
            await rcn.approve(debtEngine.address, 7150);

            await debtEngine.payTokenBatch(ids, amounts, Helper.address0x, Helper.address0x, []);

            assert.equal(await rcn.balanceOf(accounts[0]), 4150);
            assert.equal(await debtEngine.getStatus(ids[0]), 2);
            assert.equal(await testModel.getPaid(ids[0]), 3000);
        });

        it('Should apply rate pay batch tokens even when tokens is not divisible by 10', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            // 2.82711175222132156792 ETH = 4010.23333566612312 RCN
            const data = await testOracle.encodeRate(bn('401023333566612312000000'), bn('282711175222132156792'));

            await rcn.setBalance(accounts[0], toWei(1));
            await rcn.approve(debtEngine.address, toWei(1));

            await debtEngine.payTokenBatch([id], [toWei(1)], Helper.address0x, testOracle.address, data);

            assert.equal(await rcn.balanceOf(accounts[0]), bn('342').toString());
            assert.equal(await testModel.getPaid(id), bn('704974378193313').toString());
        });

        it('Should apply rate pay batch tokens with token more expensive than currency', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                testOracle.address,
                await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
            ));

            // 4.122224 RCN = 0.5 ETH :)
            const data = await testOracle.encodeRate(41222240, 5);

            await rcn.setBalance(accounts[0], toWei(2));
            await rcn.approve(debtEngine.address, toWei(2));

            await debtEngine.payTokenBatch([id], [toWei(2)], Helper.address0x, testOracle.address, data);

            assert.equal(await rcn.balanceOf(accounts[0]), 1834816);
            assert.equal(await testModel.getPaid(id), 242587496458);
        });

        it('Pay tokens batch multiple times multiple id should be like paying the sum', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.payTokenBatch([id1, id2, id1], [1000, 500, 1000], Helper.address0x, Helper.address0x, []);

            assert.equal(await rcn.balanceOf(accounts[0]), 500);
            assert.equal(await testModel.getPaid(id1), 2000);
            assert.equal(await testModel.getPaid(id2), 500);

            const debt1 = await debtEngine.debts(id1);
            assert.equal(debt1[1], 2000);

            const debt2 = await debtEngine.debts(id2);
            assert.equal(debt2[1], 500);
        });

        it('Pay token batch should emit pay event', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[4],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const data = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 1500);
            await rcn.approve(debtEngine.address, 1500);

            const receipt = await debtEngine.payTokenBatch([id1, id2], [1000, 500], accounts[4], oracle.address, data);

            // Test read oracle event
            const oracleEvent = receipt.logs.find((l) => l.event === 'ReadedOracleBatch');
            assert.isOk(oracleEvent);
            assert.equal(oracleEvent.args._count, 2);
            assert.equal(oracleEvent.args._tokens, 5);
            assert.equal(oracleEvent.args._equivalent, 10);

            // Test paid events
            const paidLogs = receipt.logs.filter((l) => l.event === 'Paid');
            assert.equal(paidLogs.length, 2);
            assert.equal(paidLogs.filter((e) => e.args._id === id1).length, 1);
            assert.equal(paidLogs.filter((e) => e.args._id === id2).length, 1);
            paidLogs.forEach((event) => {
                switch (event.args._id) {
                case id1:
                    const args = event.args;
                    assert.equal(args._requested, 0);
                    assert.equal(args._requestedTokens, 1000);
                    assert.equal(args._paid, 2000);
                    assert.equal(args._tokens, 1000);
                    assert.equal(args._sender, accounts[0]);
                    assert.equal(args._origin, accounts[4]);
                    break;
                case id2:
                    const args2 = event.args;
                    assert.equal(args2._requested, 0);
                    assert.equal(args2._requestedTokens, 500);
                    assert.equal(args2._paid, 1000);
                    assert.equal(args2._tokens, 500);
                    assert.equal(args2._sender, accounts[0]);
                    assert.equal(args2._origin, accounts[4]);
                    break;
                }
            });
        });
    });

    describe('Function withdraw', function () {
        it('Should withdraw funds from payment', async function () {
            const owner = accounts[1];
            const payer = accounts[2];
            const beneficiary = accounts[3];
            const oracle = Helper.address0x;
            const amount = bn('3000');
            const data = await testModel.encodeData(amount, (await Helper.getBlockTime()) + 2000);

            const id = await getId(debtEngine.create(
                testModel.address,
                owner,
                oracle,
                data
            ));

            const plusAmount = bn('561321');
            await rcn.setBalance(payer, amount.add(plusAmount));
            await rcn.approve(debtEngine.address, amount.add(plusAmount), { from: payer });

            await debtEngine.payToken(
                id,
                amount,
                payer,
                [],
                { from: payer }
            );

            // Withdraw funds
            await rcn.setBalance(beneficiary, '0');
            const Withdrawn1 = await Helper.toEvents(
                debtEngine.withdraw(
                    id,
                    beneficiary,
                    { from: owner }
                ),
                'Withdrawn'
            );

            assert.equal(Withdrawn1._id, id);
            assert.equal(Withdrawn1._sender, owner);
            assert.equal(Withdrawn1._to, beneficiary);
            assert.equal(Withdrawn1._amount, amount.toString());

            const debt = await debtEngine.debts(id);
            assert.equal(debt.balance, '0');

            assert.equal(await rcn.balanceOf(beneficiary), amount.toString());

            // Withdraw again, should be 0
            await rcn.setBalance(beneficiary, '0');
            const Withdrawn2 = await Helper.toEvents(
                debtEngine.withdraw(
                    id,
                    beneficiary,
                    { from: owner }
                ),
                'Withdrawn'
            );

            assert.equal(Withdrawn2._id, id);
            assert.equal(Withdrawn2._sender, owner);
            assert.equal(Withdrawn2._to, beneficiary);
            assert.equal(Withdrawn2._amount, '0');

            assert.equal(await rcn.balanceOf(beneficiary), '0');
        });

        it('Pay shoud not overflow the debt balance', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setErrorFlag(id, 10);

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.pay(id, 3000, Helper.address0x, Helper.address0x);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 3000);

            const value = bn('2').pow(bn('129'));
            await rcn.setBalance(accounts[0], value);
            await rcn.approve(debtEngine.address, value);

            await Helper.assertThrow(debtEngine.pay(id, value, Helper.address0x, Helper.address0x));

            const ndebt = await debtEngine.debts(id);
            assert.equal(ndebt[1], 3000);

            await rcn.setBalance(accounts[2], 0);
            await debtEngine.withdraw(id, accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
        });

        it('Pay token shoud not overflow the debt balance', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setErrorFlag(id, 10);

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.payToken(id, 3000, Helper.address0x, Helper.address0x);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 3000);

            const value = bn('2').pow(bn('130'));
            await rcn.setBalance(accounts[0], value);
            await rcn.approve(debtEngine.address, value);

            await Helper.assertThrow(debtEngine.payToken(id, bn('2').pow(bn('129')), Helper.address0x, Helper.address0x));

            const ndebt = await debtEngine.debts(id);
            assert.equal(ndebt[1], 3000);

            await rcn.setBalance(accounts[2], 0);
            await debtEngine.withdraw(id, accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
        });

        it('Pay batch shoud not overflow the debt balance', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(10, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await testModel.setErrorFlag(id, 10);

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.pay(id, 3000, Helper.address0x, Helper.address0x);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 3000);

            const value = bn('2').pow(bn('130'));
            await rcn.setBalance(accounts[0], value);
            await rcn.approve(debtEngine.address, value);

            await Helper.assertThrow(debtEngine.payBatch([id2, id], [10, bn('2').pow(bn('129'))], Helper.address0x, Helper.address0x, []));

            assert.equal((await testModel.getPaid(id)).toNumber(), 3000);
            assert.equal(await testModel.getPaid(id2), 0);

            const ndebt = await debtEngine.debts(id);
            assert.equal(ndebt[1], 3000);

            await rcn.setBalance(accounts[2], 0);
            await debtEngine.withdraw(id, accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
        });

        it('Should fail withdraw not authorized', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.pay(id, 3000, Helper.address0x, Helper.address0x);

            await rcn.setBalance(accounts[3], 0);
            await rcn.setBalance(accounts[2], 0);
            await Helper.assertThrow(debtEngine.withdraw(id, accounts[3], { from: accounts[3] }));
            await Helper.assertThrow(debtEngine.withdraw(id, accounts[2], { from: accounts[3] }));

            assert.equal(await rcn.balanceOf(accounts[3]), 0);
            assert.equal(await rcn.balanceOf(accounts[2]), 0);

            await debtEngine.withdraw(id, accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
            await debtEngine.withdraw(id, accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
        });

        it('Should fail withdraw if debt engine has no funds', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.pay(id, 3000, Helper.address0x, Helper.address0x);

            const auxBalance = await rcn.balanceOf(debtEngine.address);
            await rcn.setBalance(debtEngine.address, 0);

            await rcn.setBalance(accounts[2], 0);
            await Helper.assertThrow(debtEngine.withdraw(id, accounts[2], { from: accounts[2] }));

            assert.equal(await rcn.balanceOf(accounts[2]), 0);

            await rcn.setBalance(debtEngine.address, auxBalance);
        });

        it('Should withdraw partial payments, authorized', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(1000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 4000);

            await rcn.approve(debtEngine.address, 4000);
            await debtEngine.pay(id, 50, accounts[3], []);

            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            await debtEngine.pay(id, 50, accounts[3], []);

            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 100);

            await debtEngine.setApprovalForAll(accounts[7], true);
            await rcn.setBalance(accounts[7], 0);
            await debtEngine.withdraw(id, accounts[7], { from: accounts[7] });
            await debtEngine.setApprovalForAll(accounts[7], false);
            assert.equal(await rcn.balanceOf(accounts[7]), 100);

            await rcn.setBalance(accounts[2], 200);
            await debtEngine.pay(id, 200, accounts[2], []);

            // Next withdraw should fail, no longer approved
            await rcn.setBalance(accounts[7], 0);
            Helper.assertThrow(debtEngine.withdraw(id, accounts[7], { from: accounts[7] }));
            debtEngine.withdrawBatch([id], accounts[7], { from: accounts[7] });
            assert.equal(await rcn.balanceOf(accounts[7]), 0);

            await debtEngine.approve(accounts[8], id);
            await rcn.setBalance(accounts[8], 0);
            await debtEngine.withdrawBatch([id], accounts[8], { from: accounts[8] });
            assert.equal(await rcn.balanceOf(accounts[8]), 200);
        });
    });

    describe('Function withdrawPartial', function () {
        it('Should fail to withdraw partially if sender is not authorized', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[1],
                Helper.address0x,
                await testModel.encodeData(1000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);

            await debtEngine.pay(id, 1000, accounts[0], []);

            await Helper.tryCatchRevert(debtEngine.withdrawPartial(id, accounts[0], 500), 'Sender not authorized');
            await Helper.tryCatchRevert(debtEngine.withdrawPartial(id, accounts[1], 500), 'Sender not authorized');

            assert.equal((await rcn.balanceOf(accounts[1])), 0);
            assert.equal((await rcn.balanceOf(accounts[0])), 0);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 1000);
        });

        it('Should withdraw partially if sender is authorized', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[1],
                Helper.address0x,
                await testModel.encodeData(1000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[2], 0);
            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);
            await debtEngine.approve(accounts[0], id, { from: accounts[1] });

            await debtEngine.pay(id, 1000, accounts[0], []);

            await debtEngine.withdrawPartial(id, accounts[2], 600);

            assert.equal((await rcn.balanceOf(accounts[2])), 600);
            assert.equal((await rcn.balanceOf(accounts[1])), 0);
            assert.equal((await rcn.balanceOf(accounts[0])), 0);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 400);
        });

        it('Should withdraw partially total amount', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(1000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);

            await debtEngine.pay(id, 1000, accounts[0], []);

            await rcn.setBalance(accounts[0], 0);
            await rcn.setBalance(accounts[2], 0);

            await debtEngine.withdrawPartial(id, accounts[2], 1000);

            assert.equal((await rcn.balanceOf(accounts[2])), 1000);
            assert.equal((await rcn.balanceOf(accounts[0])), 0);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 0);
        });

        it('Should fail to withdraw more than available', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(1000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);

            await debtEngine.pay(id, 1000, accounts[0], []);

            await rcn.setBalance(accounts[0], 0);
            await rcn.setBalance(accounts[2], 0);

            await Helper.tryCatchRevert(debtEngine.withdrawPartial(id, accounts[2], 1100), 'Debt balance is not enought');

            assert.equal((await rcn.balanceOf(accounts[2])), 0);
            assert.equal((await rcn.balanceOf(accounts[0])), 0);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 1000);
        });

        it('Should fail to withdraw a more than possible balance', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(1000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);

            await debtEngine.pay(id, 1000, accounts[0], []);

            await rcn.setBalance(accounts[0], 0);
            await rcn.setBalance(accounts[2], 0);

            await Helper.tryCatchRevert(
                debtEngine.withdrawPartial(
                    id,
                    accounts[2],
                    '0xfffffffffffffffffffffffffffffffff'
                ),
                'Debt balance is not enought'
            );

            assert.equal((await rcn.balanceOf(accounts[2])), 0);
            assert.equal((await rcn.balanceOf(accounts[0])), 0);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 1000);
        });

        it('Should fail to withdraw if debt engine has no tokens', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                Helper.address0x,
                await testModel.encodeData(1000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 1000);
            await rcn.approve(debtEngine.address, 1000);

            await debtEngine.pay(id, 1000, accounts[0], []);

            await rcn.setBalance(accounts[0], 0);
            await rcn.setBalance(accounts[2], 0);

            const prevBalance = await rcn.balanceOf(debtEngine.address);
            await rcn.setBalance(debtEngine.address, 0);
            await Helper.tryCatchRevert(debtEngine.withdrawPartial(id, accounts[2], 200), 'Error sending tokens');
            await rcn.setBalance(debtEngine.address, prevBalance);

            assert.equal((await rcn.balanceOf(accounts[2])), 0);
            assert.equal((await rcn.balanceOf(accounts[0])), 0);

            const debt = await debtEngine.debts(id);
            assert.equal(debt[1], 1000);
        });
    });

    describe('Function withdrawBatch', function () {
        it('Should withdraw funds from multiple debts', async function () {
            const owner = accounts[1];
            const payer = accounts[2];
            const beneficiary = accounts[3];
            const oracle = Helper.address0x;

            const amount1 = bn('3000');
            const data1 = await testModel.encodeData(amount1, (await Helper.getBlockTime()) + 2000);

            const amount2 = bn('7000');
            const data2 = await testModel.encodeData(amount2, (await Helper.getBlockTime()) + 2000);

            const id1 = await getId(debtEngine.create(
                testModel.address,
                owner,
                oracle,
                data1
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                owner,
                oracle,
                data2
            ));

            await rcn.setBalance(payer, amount1.add(amount2));
            await rcn.approve(debtEngine.address, amount1.add(amount2));

            await debtEngine.payTokenBatch(
                [id1, id2],
                [amount1, amount2],
                payer,
                oracle,
                [],
                { from: payer }
            );

            // Withdraw funds
            await rcn.setBalance(beneficiary, 0);
            const Withdrawn = await Helper.toEvents(
                debtEngine.withdrawBatch(
                    [id1, id2],
                    beneficiary,
                    { from: owner }
                ),
                'Withdrawn'
            );

            assert.equal(Withdrawn[0]._id, id1);
            assert.equal(Withdrawn[0]._sender, owner);
            assert.equal(Withdrawn[0]._to, beneficiary);
            assert.equal(Withdrawn[0]._amount, amount1.toString());

            assert.equal(Withdrawn[1]._id, id2);
            assert.equal(Withdrawn[1]._sender, owner);
            assert.equal(Withdrawn[1]._to, beneficiary);
            assert.equal(Withdrawn[1]._amount, amount2.toString());

            const debt1 = await debtEngine.debts(id1);
            assert.equal(debt1.balance, '0');

            const debt2 = await debtEngine.debts(id2);
            assert.equal(debt2.balance, '0');

            assert.equal(await rcn.balanceOf(beneficiary), 10000);

            // Withdraw again, should be 0
            await rcn.setBalance(beneficiary, 0);
            await debtEngine.withdraw(id1, beneficiary, { from: owner });
            await debtEngine.withdraw(id2, beneficiary, { from: owner });
            await debtEngine.withdrawBatch([id1, id2], beneficiary, { from: owner });
            assert.equal(await rcn.balanceOf(beneficiary), 0);
        });

        it('Should pay using an Oracle and withdraw', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[0],
                oracle.address,
                await testModel.encodeData(10000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData1 = await legacyOracle.dummyData1();
            const dummyData2 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[2], 60000);
            await rcn.approve(debtEngine.address, 60000, { from: accounts[2] });
            await debtEngine.pay(id, 10, accounts[1], dummyData1, { from: accounts[2] });

            await rcn.approve(debtEngine.address, 500, { from: accounts[3] });
            await rcn.setBalance(accounts[3], 500);
            await debtEngine.pay(id, 1000, Helper.address0x, dummyData2, { from: accounts[3] });

            await rcn.approve(debtEngine.address, 6000, { from: accounts[3] });
            await rcn.setBalance(accounts[3], 10000);
            await debtEngine.pay(id, 10000, accounts[0], dummyData2, { from: accounts[3] });

            // Withdraw
            await debtEngine.transferFrom(accounts[0], accounts[9], id);
            await rcn.setBalance(accounts[9], 0);
            await debtEngine.withdrawBatch([id], accounts[9], { from: accounts[9] });
            assert.equal(await rcn.balanceOf(accounts[9]), 60000 + 500 + (10000 - 1010) / 2);

            // Withdraw again should transfer 0
            await rcn.setBalance(accounts[9], 0);
            await debtEngine.approve(accounts[3], id, { from: accounts[9] });
            await debtEngine.withdrawBatch([id], accounts[9], { from: accounts[3] });
            assert.equal(await rcn.balanceOf(accounts[9]), 0);
        });

        it('Should fail withdraw batch if debt engine has no funds', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.payBatch([id, id2], [1500, 1500], Helper.address0x, Helper.address0x, []);

            const auxBalance = await rcn.balanceOf(debtEngine.address);
            await rcn.setBalance(debtEngine.address, 0);

            await rcn.setBalance(accounts[2], 0);
            await Helper.assertThrow(debtEngine.withdrawBatch([id, id2], accounts[2], { from: accounts[2] }));

            assert.equal(await rcn.balanceOf(accounts[2]), 0);

            await rcn.setBalance(debtEngine.address, auxBalance);
        });

        it('Should fail withdraw batch not authorized', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.payBatch([id1, id2], [1500, 1500], Helper.address0x, Helper.address0x, []);

            await rcn.setBalance(accounts[3], 0);
            await rcn.setBalance(accounts[2], 0);
            await debtEngine.withdrawBatch([id1, id2], accounts[3], { from: accounts[3] });
            await debtEngine.withdrawBatch([id1, id2], accounts[2], { from: accounts[3] });

            assert.equal(await rcn.balanceOf(accounts[3]), 0);
            assert.equal(await rcn.balanceOf(accounts[2]), 0);

            await debtEngine.withdrawBatch([id1, id2], accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
            await debtEngine.withdrawBatch([id1, id2], accounts[2], { from: accounts[2] });
            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
        });

        it('Should fail withdraw batch not authorized mixed', async function () {
            const id1 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[4],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.payBatch([id1, id2], [1500, 1500], Helper.address0x, Helper.address0x, []);

            await rcn.setBalance(accounts[3], 0);
            await rcn.setBalance(accounts[2], 0);
            await debtEngine.withdrawBatch([id1, id2], accounts[3], { from: accounts[3] });
            await debtEngine.withdrawBatch([id1, id2], accounts[2], { from: accounts[3] });

            assert.equal(await rcn.balanceOf(accounts[3]), 0);
            assert.equal(await rcn.balanceOf(accounts[2]), 0);

            await rcn.setBalance(accounts[4], 0);
            await debtEngine.withdrawBatch([id1, id2], accounts[4], { from: accounts[4] });

            assert.equal(await rcn.balanceOf(accounts[4]), 1500);
        });

        it('Withdraw multiple times same id should make no difference', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const id2 = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            await rcn.setBalance(accounts[0], 3000);
            await rcn.approve(debtEngine.address, 3000);

            await debtEngine.payBatch([id, id2], [1500, 1500], Helper.address0x, Helper.address0x, []);

            await rcn.setBalance(accounts[2], 0);
            await debtEngine.withdrawBatch([id, id, id2, id, id, id, id], accounts[2], { from: accounts[2] });

            assert.equal(await rcn.balanceOf(accounts[2]), 3000);
        });

        it('Withdraw zero debts should have no effect', async function () {
            await rcn.setBalance(accounts[7], 0);
            await debtEngine.withdrawBatch([], accounts[7], { from: accounts[7] });
            assert.equal(await rcn.balanceOf(accounts[7]), 0);
        });
    });

    describe('Errors tests', function () {
        it('Should catch and recover from a pay infinite loop, with an Oracle', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData2 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 25);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 50, accounts[3], dummyData2);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 2);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 100, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 50);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 100, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Should catch and recover from a pay infinite loop, with an Oracle', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                oracle.address,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            const dummyData2 = await legacyOracle.dummyData2();

            await rcn.setBalance(accounts[0], 25);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 50, accounts[3], dummyData2);

            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 50);

            // Set the error flag
            await testModel.setErrorFlag(id, 2);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 100, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 50);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);
            assert.equal(await testModel.getPaid(id), 50);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 50);

            await rcn.approve(debtEngine.address, 50);
            await debtEngine.pay(id, 100, accounts[3], dummyData2);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 150);
        });

        it('Should catch a getStatus error', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            // Set the error flag
            await testModel.setErrorFlag(id, 3);

            // Try to read status
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.payToken(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 100);
        });

        it('Should catch a getStatus infinite loop', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            // Set the error flag
            await testModel.setErrorFlag(id, 4);

            // Try to read status
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.payToken(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 100);
        });

        it('Should catch and recover from a run error', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            // Set the error flag
            await testModel.setErrorFlag(id, 6);

            // Run and read status
            await debtEngine.run(id);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await debtEngine.run(id);

            // Should have failed and the status should be 4
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
        });

        it('Should catch and recover from a run infinite loop', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            // Set the error flag
            await testModel.setErrorFlag(id, 7);

            // Run and read status
            await debtEngine.run(id);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await debtEngine.run(id);

            // Should have failed and the status should be 4
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
        });

        it('Should catch a getStatus write storage error', async function () {
            const id = await getId(debtEngine.create(
                testModel.address,
                accounts[2],
                Helper.address0x,
                await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
            ));

            // Set the error flag
            await testModel.setErrorFlag(id, 5);

            // Try to read status
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ERROR);

            // Remove the flag
            await testModel.setErrorFlag(id, 0);

            // Try to pay
            await rcn.setBalance(accounts[0], 100);

            await rcn.approve(debtEngine.address, 100);
            await debtEngine.payToken(id, 100, accounts[3], []);

            // Should have failed and the status should be 4
            assert.equal(await rcn.balanceOf(accounts[0]), 0);
            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            assert.equal(await testModel.getPaid(id), 100);
        });
    });

    it('Funds should follow the debt', async function () {
        const id = await getId(debtEngine.create(
            testModel.address,
            accounts[0],
            Helper.address0x,
            await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
        ));

        await rcn.setBalance(accounts[0], 4000);

        await rcn.approve(debtEngine.address, 4000);
        await debtEngine.pay(id, 4000, accounts[3], []);

        assert.equal(await rcn.balanceOf(accounts[0]), 1000);
        assert.equal(await debtEngine.getStatus(id), 2);
        assert.equal(await testModel.getPaid(id), 3000);

        // Transfer debt
        await debtEngine.transferFrom(accounts[0], accounts[6], id);

        // Withdraw funds
        await rcn.setBalance(accounts[6], 0);
        await debtEngine.withdraw(id, accounts[6], { from: accounts[6] });
        assert.equal(await rcn.balanceOf(accounts[6]), 3000);
    });

    it('Calling pay, payTokens, payBatch or payBatchTokens should get the same rate', async function () {
        const id1 = await getId(debtEngine.create(
            testModel.address,
            accounts[0],
            testOracle.address,
            await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
        ));

        const id2 = await getId(debtEngine.create(
            testModel.address,
            accounts[0],
            testOracle.address,
            await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
        ));

        const id3 = await getId(debtEngine.create(
            testModel.address,
            accounts[0],
            testOracle.address,
            await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
        ));

        const id4 = await getId(debtEngine.create(
            testModel.address,
            accounts[0],
            testOracle.address,
            await testModel.encodeData(toWei('900000'), (await Helper.getBlockTime()) + 2000)
        ));

        // 4 RCN = 22.94 ETH :)
        const data = await testOracle.encodeRate(4, 2294);

        await rcn.setBalance(accounts[0], toWei(2000));
        await rcn.approve(debtEngine.address, toWei(2000));

        await debtEngine.payToken(id1, toWei(1), Helper.address0x, data);
        await debtEngine.payTokenBatch([id3], [toWei(1)], Helper.address0x, testOracle.address, data);

        const paid1 = await testModel.getPaid(id1);
        assert.equal(paid1, (await testModel.getPaid(id3)).toString());

        await debtEngine.pay(id2, paid1, Helper.address0x, data);
        await debtEngine.payBatch([id4], [paid1], Helper.address0x, testOracle.address, data);

        assert.equal(paid1, (await testModel.getPaid(id4)).toString());
        assert.equal(paid1, (await testModel.getPaid(id2)).toString());
    });

    // Notice: Keep this test last
    it('Should not be possible to brute-forze an infinite loop', async function () {
        const id = await getId(debtEngine.create(
            testModel.address,
            accounts[2],
            Helper.address0x,
            await testModel.encodeData(3000, (await Helper.getBlockTime()) + 2000)
        ));

        await rcn.setBalance(accounts[0], 50);

        await rcn.approve(debtEngine.address, 50);
        await debtEngine.payToken(id, 50, accounts[3], []);

        assert.equal(await rcn.balanceOf(accounts[0]), 0);
        assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
        assert.equal(await testModel.getPaid(id), 50);

        await rcn.setBalance(accounts[0], 100);
        await rcn.approve(debtEngine.address, 100);

        // Try to pay with different gas limits
        for (let i = 20000; i < 8000000; i += 1010) {
            try {
                await debtEngine.payToken(id, 100, accounts[3], [], { gas: i });
            } catch (ignored) {
            }

            assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
            // eslint-disable-next-line eqeqeq
            if (await testModel.getPaid(id) == 150) {
                break;
            }
        }

        // Should have failed and the status should be 1
        assert.equal(await debtEngine.getStatus(id), Helper.STATUS_ONGOING);
        assert.equal(await testModel.getPaid(id), 150);
    });
});
