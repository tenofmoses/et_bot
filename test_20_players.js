// Detailed analysis of tournament bracket for exactly 20 players

function analyze20Players() {
    console.log('=== ДЕТАЛЬНЫЙ АНАЛИЗ ДЛЯ 20 ИГРОКОВ ===\n');
    
    const playerCount = 20;
    const totalRounds = Math.ceil(Math.log2(playerCount)); // 5 раундов
    
    console.log(`Общее количество игроков: ${playerCount}`);
    console.log(`Расчетное количество раундов: ${totalRounds}\n`);
    
    // Step 1: Determine if bye player needed
    console.log('ШАГ 1: Определение необходимости bye player');
    console.log('=====================================');
    
    // Check if any round will have odd winners
    let tempWinners = Math.floor(playerCount / 2); // 10 winners from first round
    let needsByePlayer = false;
    
    console.log(`Победители первого раунда: ${tempWinners}`);
    
    while (tempWinners > 1) {
        if (tempWinners % 2 === 1) {
            needsByePlayer = true;
            console.log(`❗ Обнаружено нечетное количество победителей: ${tempWinners}`);
            break;
        }
        tempWinners = Math.floor(tempWinners / 2);
        console.log(`Следующий раунд будет иметь: ${tempWinners} победителей`);
    }
    
    console.log(`Нужен bye player: ${needsByePlayer ? 'ДА' : 'НЕТ'}\n`);
    
    // Step 2: Bracket creation logic
    console.log('ШАГ 2: Создание турнирной сетки');
    console.log('===============================');
    
    let currentPlayerCount = playerCount;
    let byePlayer = null;
    
    if (needsByePlayer) {
        byePlayer = `Player_${playerCount}`; // Last player becomes bye
        currentPlayerCount = playerCount - 1; // 19 players
        console.log(`Bye player: ${byePlayer}`);
        console.log(`Игроков для первого раунда: ${currentPlayerCount}`);
        
        // Ensure even number for first round
        if (currentPlayerCount % 2 === 1) {
            currentPlayerCount = currentPlayerCount - 1; // 18 players
            console.log(`Скорректировано до ${currentPlayerCount} игроков для четного первого раунда`);
        }
    }
    
    console.log(`Финальное количество игроков в первом раунде: ${currentPlayerCount}\n`);
    
    // Step 3: Round-by-round breakdown
    console.log('ШАГ 3: Пошаговый разбор раундов');
    console.log('==============================');
    
    const firstRoundMatches = currentPlayerCount / 2;
    console.log(`РАУНД 1: ${firstRoundMatches} матчей (${currentPlayerCount} игроков)`);
    
    // Calculate when bye player joins
    let byeRound = -1;
    if (byePlayer) {
        let winnersCount = firstRoundMatches;
        
        for (let round = 1; round < totalRounds; round++) {
            if ((winnersCount + 1) % 2 === 0) {
                byeRound = round;
                console.log(`Bye player присоединится в раунде ${round + 1}`);
                break;
            }
            winnersCount = Math.ceil(winnersCount / 2);
        }
    }
    
    // Simulate all rounds
    let currentWinners = firstRoundMatches;
    
    for (let round = 1; round < totalRounds; round++) {
        if (round === byeRound) {
            currentWinners += 1;
            console.log(`РАУНД ${round + 1}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков, включая bye)`);
        } else {
            console.log(`РАУНД ${round + 1}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков)`);
        }
        
        if (currentWinners > 2 && currentWinners % 2 === 1 && round !== byeRound) {
            console.log(`  ⚠️ Нечетное количество игроков (${currentWinners}) - один получит автоматический проход`);
        }
        
        currentWinners = Math.ceil(currentWinners / 2);
    }
    
    console.log('\n=== ИТОГОВАЯ СТРУКТУРА ТУРНИРА ===');
    console.log('Раунд 1: 9 матчей (18 игроков)');
    console.log('Раунд 2: 5 матчей (10 игроков, включая bye)');
    console.log('Раунд 3: 3 матча (5 игроков) - один получает проход');
    console.log('Раунд 4: 2 матча (3 игрока) - один получает проход');
    console.log('Раунд 5: 1 матч (финал)');
    
    console.log('\n=== ПРИМЕР КОНКРЕТНЫХ ИГРОКОВ ===');
    console.log('Игроки 1-18: участвуют в первом раунде');
    console.log('Игрок 19: исключен для четности');
    console.log('Игрок 20: bye player, присоединяется во втором раунде');
    
    console.log('\nПобедители раунда 1: 9 игроков');
    console.log('Раунд 2: 9 + bye player = 10 игроков → 5 матчей');
    console.log('Далее стандартная элиминация до финала');
}

// Run the analysis
analyze20Players();
