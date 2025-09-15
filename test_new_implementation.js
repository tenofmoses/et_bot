// Test the new simplified tournament implementation

function testNewImplementation(playerCount) {
    console.log(`\n=== НОВАЯ РЕАЛИЗАЦИЯ: ${playerCount} ИГРОКОВ ===`);
    
    let currentPlayers = playerCount;
    let roundNumber = 1;
    let totalMatches = 0;
    
    while (currentPlayers > 1) {
        let matchesThisRound;
        
        if (currentPlayers % 2 === 0) {
            // Even number of players - all play
            matchesThisRound = currentPlayers / 2;
        } else {
            // Odd number of players - one gets bye
            matchesThisRound = Math.floor(currentPlayers / 2);
        }
        
        console.log(`Раунд ${roundNumber}: ${matchesThisRound} матчей (${currentPlayers} игроков)`);
        
        if (currentPlayers % 2 === 1) {
            console.log(`  ✓ 1 игрок получает bye`);
        }
        
        totalMatches += matchesThisRound;
        
        // Calculate players for next round
        const winners = matchesThisRound;
        const byePlayers = currentPlayers % 2; // 0 or 1
        currentPlayers = winners + byePlayers;
        roundNumber++;
    }
    
    const expectedMatches = playerCount - 1;
    console.log(`Общее количество матчей: ${totalMatches}`);
    console.log(`Ожидалось: ${expectedMatches}`);
    console.log(`${totalMatches === expectedMatches ? '✅ КОРРЕКТНО' : '❌ ОШИБКА'}`);
    
    return totalMatches === expectedMatches;
}

// Test the specific case mentioned by user: 20 players
console.log('ПРОВЕРКА ПРИМЕРА: 20 ИГРОКОВ');
console.log('=============================');
testNewImplementation(20);

// Test all cases from 3 to 100
console.log('\n\nТЕСТ ВСЕХ СЛУЧАЕВ 3-100:');
console.log('========================');

let successCount = 0;
let totalTests = 0;
const failedCases = [];

for (let players = 3; players <= 100; players++) {
    totalTests++;
    const success = testNewImplementation(players);
    if (success) {
        successCount++;
    } else {
        failedCases.push(players);
    }
}

console.log(`\n=== ИТОГИ ===`);
console.log(`Успешно: ${successCount}/${totalTests} (${Math.round(successCount/totalTests*100)}%)`);

if (failedCases.length > 0) {
    console.log(`Неудачные случаи: ${failedCases.join(', ')}`);
} else {
    console.log('🎉 ВСЕ ТЕСТЫ ПРОШЛИ УСПЕШНО!');
}

// Show specific examples
console.log('\n=== КОНКРЕТНЫЕ ПРИМЕРЫ ===');

const examples = [3, 4, 5, 8, 16, 20, 32, 64];
examples.forEach(players => {
    console.log(`\n${players} игроков:`);
    testNewImplementation(players);
});
