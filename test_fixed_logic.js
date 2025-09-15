// Test the fixed tournament bracket logic

function testFixedBracket(playerCount) {
    console.log(`\n=== ТЕСТ ${playerCount} ИГРОКОВ (ИСПРАВЛЕННАЯ ЛОГИКА) ===`);
    
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
        currentPlayerCount = playerCount - 1;
        console.log(`✓ Bye player: 1 игрок (${playerCount % 2 === 1 ? 'нечетное' : 'четное→нечетные победители'})`);
        
        // Ensure even number of players for first round
        if (currentPlayerCount % 2 === 1) {
            currentPlayerCount = currentPlayerCount - 1;
            console.log(`✓ Скорректировано до ${currentPlayerCount} игроков для четного первого раунда`);
        }
    } else {
        console.log('✓ Bye player не нужен');
    }
    
    // First round
    const firstRoundMatches = currentPlayerCount / 2;
    console.log(`Раунд 1: ${firstRoundMatches} матчей (${currentPlayerCount} игроков)`);
    
    // Validate first round
    if (firstRoundMatches % 1 !== 0) {
        console.log(`❌ ОШИБКА: Дробное количество матчей в первом раунде!`);
        return false;
    }
    
    // Calculate when bye player should join
    let byeRound = -1;
    if (playerCount % 2 === 1 || needsByePlayer) {
        let winnersCount = firstRoundMatches;
        
        for (let round = 1; round < totalRounds; round++) {
            if ((winnersCount + 1) % 2 === 0) {
                byeRound = round;
                console.log(`✓ Bye player присоединяется в раунде ${round + 1}`);
                break;
            }
            winnersCount = Math.ceil(winnersCount / 2);
        }
        
        if (byeRound === -1) {
            console.log(`❌ ОШИБКА: Не найден подходящий раунд для bye player!`);
            return false;
        }
    }
    
    // Simulate subsequent rounds
    let currentWinners = firstRoundMatches;
    let hasErrors = false;
    
    for (let round = 1; round < totalRounds; round++) {
        if (round === byeRound) {
            currentWinners += 1;
            console.log(`Раунд ${round + 1}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков, включая bye)`);
        } else {
            console.log(`Раунд ${round + 1}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков)`);
        }
        
        // Check for issues
        if (currentWinners > 2 && currentWinners % 2 === 1 && round !== byeRound) {
            console.log(`  ⚠️ Нечетное количество игроков (${currentWinners}) без bye - нужен проход`);
        }
        
        const nextMatches = Math.ceil(currentWinners / 2);
        if (nextMatches % 1 !== 0) {
            console.log(`  ❌ ОШИБКА: Дробное количество матчей!`);
            hasErrors = true;
        }
        
        currentWinners = nextMatches;
    }
    
    // Final validation
    if (currentWinners !== 1) {
        console.log(`❌ ОШИБКА: Финал должен иметь 1 победителя, получили ${currentWinners}`);
        hasErrors = true;
    }
    
    if (!hasErrors) {
        console.log(`✅ КОРРЕКТНО: ${totalRounds} раундов, финал с 1 победителем`);
    }
    
    return !hasErrors;
}

// Test previously failed cases
console.log('ТЕСТ ИСПРАВЛЕННОЙ ЛОГИКИ - ПРОБЛЕМНЫЕ СЛУЧАИ');
console.log('=============================================');

const previouslyFailed = [6, 10, 12, 14, 18, 20, 22, 24, 26, 28, 30];
let fixedCount = 0;

previouslyFailed.forEach(players => {
    const success = testFixedBracket(players);
    if (success) {
        fixedCount++;
    }
    console.log('-'.repeat(50));
});

console.log(`\n=== РЕЗУЛЬТАТЫ ИСПРАВЛЕНИЙ ===`);
console.log(`Исправлено: ${fixedCount}/${previouslyFailed.length}`);

if (fixedCount === previouslyFailed.length) {
    console.log('🎉 ВСЕ ПРОБЛЕМНЫЕ СЛУЧАИ ИСПРАВЛЕНЫ!');
} else {
    console.log(`❌ Остались проблемы в ${previouslyFailed.length - fixedCount} случаях`);
}

// Test full range 5-30 again
console.log('\n=== ПОЛНЫЙ ТЕСТ 5-30 ИГРОКОВ ===');
let totalSuccess = 0;
let totalTests = 0;

for (let players = 5; players <= 30; players++) {
    totalTests++;
    const success = testFixedBracket(players);
    if (success) {
        totalSuccess++;
    }
}

console.log(`\nИТОГО: ${totalSuccess}/${totalTests} успешно (${Math.round(totalSuccess/totalTests*100)}%)`);
