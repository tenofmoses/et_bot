// Test correct single-elimination tournament logic

function correctTournamentLogic(playerCount) {
    console.log(`\n=== ПРАВИЛЬНАЯ ЛОГИКА ДЛЯ ${playerCount} ИГРОКОВ ===`);
    
    // For single elimination: each match eliminates exactly 1 player
    // So we need (playerCount - 1) total matches to eliminate all but 1 player
    const totalMatches = playerCount - 1;
    console.log(`Общее количество матчей для элиминации: ${totalMatches}`);
    
    let currentPlayers = playerCount;
    let round = 1;
    let totalMatchesUsed = 0;
    
    while (currentPlayers > 1) {
        let matchesThisRound;
        let playersAdvancing;
        
        if (currentPlayers % 2 === 0) {
            // Even number of players - all play
            matchesThisRound = currentPlayers / 2;
            playersAdvancing = matchesThisRound;
        } else {
            // Odd number of players - one gets bye
            matchesThisRound = Math.floor(currentPlayers / 2);
            playersAdvancing = matchesThisRound + 1; // +1 for bye player
        }
        
        console.log(`Раунд ${round}: ${matchesThisRound} матчей (${currentPlayers} игроков) → ${playersAdvancing} проходят`);
        
        if (currentPlayers % 2 === 1) {
            console.log(`  ✓ 1 игрок получает bye (автоматический проход)`);
        }
        
        totalMatchesUsed += matchesThisRound;
        currentPlayers = playersAdvancing;
        round++;
    }
    
    console.log(`Итого раундов: ${round - 1}`);
    console.log(`Использовано матчей: ${totalMatchesUsed}`);
    console.log(`Ожидалось матчей: ${totalMatches}`);
    
    const isCorrect = totalMatchesUsed === totalMatches;
    console.log(`${isCorrect ? '✅ КОРРЕКТНО' : '❌ ОШИБКА'}`);
    
    return isCorrect;
}

// Test example from user: 20 players
console.log('ПРОВЕРКА ПРИМЕРА ПОЛЬЗОВАТЕЛЯ:');
console.log('==============================');

function test20PlayersCorrect() {
    console.log('\n=== 20 ИГРОКОВ - ПРАВИЛЬНАЯ ЛОГИКА ===');
    console.log('Раунд 1: 10 матчей (20 игроков) → 10 победителей');
    console.log('Раунд 2: 2 матча (5 игроков) → 2 победителя + 1 bye');
    console.log('Раунд 3: 1 матч (3 игрока) → 1 победитель + 1 bye');
    console.log('Раунд 4: 1 матч (2 игрока) → 1 чемпион');
    console.log('Общее количество матчей: 10 + 2 + 1 + 1 = 14');
    console.log('Ожидается матчей: 20 - 1 = 19');
    console.log('❌ НЕ СОВПАДАЕТ - логика неверна');
}

test20PlayersCorrect();

// Test all player counts from 3 to 30 first
console.log('\n\nТЕСТ ПРАВИЛЬНОЙ ЛОГИКИ 3-30 ИГРОКОВ:');
console.log('===================================');

let successCount = 0;
let totalTests = 0;

for (let players = 3; players <= 30; players++) {
    totalTests++;
    const success = correctTournamentLogic(players);
    if (success) {
        successCount++;
    }
}

console.log(`\n=== РЕЗУЛЬТАТЫ 3-30 ===`);
console.log(`Успешно: ${successCount}/${totalTests}`);

// Test larger numbers
console.log('\n\nТЕСТ БОЛЬШИХ ЧИСЕЛ:');
console.log('==================');

const largeCounts = [50, 64, 100];
largeCounts.forEach(players => {
    correctTournamentLogic(players);
});

// Show what the correct 20-player tournament should look like
console.log('\n\n=== ПРАВИЛЬНАЯ СТРУКТУРА ДЛЯ 20 ИГРОКОВ ===');
console.log('Раунд 1: 10 матчей (20 игроков) → 10 победителей');
console.log('Раунд 2: 5 матчей (10 игроков) → 5 победителей'); 
console.log('Раунд 3: 2 матча (5 игроков) → 2 победителя + 1 bye');
console.log('Раунд 4: 1 матч (3 игрока) → 1 победитель + 1 bye');
console.log('Раунд 5: 1 матч (2 игрока) → 1 чемпион');
console.log('Общее количество матчей: 10 + 5 + 2 + 1 + 1 = 19 ✅');
