// Test the updated bracket logic for 7, 9, 10 players

function simulateUniversalBracket(playerCount) {
    console.log(`\n=== СИМУЛЯЦИЯ ДЛЯ ${playerCount} ИГРОКОВ ===`);
    
    const totalRounds = Math.ceil(Math.log2(playerCount));
    
    // Determine if we need a bye player
    let needsByePlayer = false;
    let currentPlayerCount = playerCount;
    
    // Check if any round will have odd number of winners
    let tempWinners = Math.floor(playerCount / 2);
    while (tempWinners > 1) {
        if (tempWinners % 2 === 1) {
            needsByePlayer = true;
            break;
        }
        tempWinners = Math.floor(tempWinners / 2);
    }
    
    // If odd number of players OR even players that create odd winners, use bye
    if (playerCount % 2 === 1 || needsByePlayer) {
        console.log(`Bye player нужен: ${playerCount % 2 === 1 ? 'нечетное количество' : 'четное, но создает нечетных победителей'}`);
        currentPlayerCount = playerCount - 1;
    } else {
        console.log('Bye player не нужен');
    }
    
    // First round
    const firstRoundMatches = currentPlayerCount / 2;
    console.log(`Раунд 1: ${firstRoundMatches} матчей (${currentPlayerCount} игроков)`);
    
    // Calculate when bye player should join
    let byeRound = -1;
    if (playerCount % 2 === 1 || needsByePlayer) {
        let winnersCount = firstRoundMatches;
        
        for (let round = 1; round < totalRounds; round++) {
            if ((winnersCount + 1) % 2 === 0) {
                byeRound = round;
                console.log(`Bye player присоединяется в раунде ${round + 1}`);
                break;
            }
            winnersCount = Math.ceil(winnersCount / 2);
        }
    }
    
    // Simulate subsequent rounds
    let currentWinners = firstRoundMatches;
    for (let round = 1; round < totalRounds; round++) {
        if (round === byeRound) {
            currentWinners += 1;
            console.log(`Раунд ${round + 1}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков, включая bye)`);
        } else {
            console.log(`Раунд ${round + 1}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков)`);
        }
        
        // Check for odd winners that need handling
        if (currentWinners > 2 && currentWinners % 2 === 1) {
            console.log(`  ⚠️ Нечетное количество игроков (${currentWinners}) - один получит проход`);
        }
        
        currentWinners = Math.ceil(currentWinners / 2);
    }
    
    return { totalRounds, needsByePlayer, byeRound };
}

// Test specific scenarios
console.log('ТЕСТ ОБНОВЛЕННОЙ ЛОГИКИ:');
[7, 9, 10].forEach(playerCount => {
    simulateUniversalBracket(playerCount);
    console.log('='.repeat(50));
});

// Test edge cases
console.log('\nДОПОЛНИТЕЛЬНЫЕ ТЕСТЫ:');
[6, 8, 12, 16].forEach(playerCount => {
    simulateUniversalBracket(playerCount);
    console.log('='.repeat(50));
});
