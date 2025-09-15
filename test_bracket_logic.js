// Test script to analyze tournament bracket logic for different player counts

function calculateTournamentBracket(playerCount) {
    console.log(`\n=== АНАЛИЗ ДЛЯ ${playerCount} ИГРОКОВ ===`);
    
    if (playerCount % 2 === 0) {
        // Even number of players - use regular bracket
        console.log("Четное количество игроков - обычная сетка");
        
        const totalRounds = Math.ceil(Math.log2(playerCount));
        console.log(`Общее количество раундов: ${totalRounds}`);
        
        let currentMatches = playerCount / 2;
        console.log(`Раунд 1: ${currentMatches} матчей (${playerCount} игроков)`);
        
        for (let round = 2; round <= totalRounds; round++) {
            currentMatches = Math.ceil(currentMatches / 2);
            console.log(`Раунд ${round}: ${currentMatches} матчей (${currentMatches * 2} игроков)`);
        }
        
        return { type: 'even', totalRounds, byePlayer: false };
    } else {
        // Odd number of players - one gets bye
        console.log("Нечетное количество игроков - один получает проход");
        
        const playersInFirstRound = playerCount - 1;
        const firstRoundMatches = playersInFirstRound / 2;
        const totalRounds = Math.ceil(Math.log2(playerCount));
        
        console.log(`Раунд 1: ${firstRoundMatches} матчей (${playersInFirstRound} игроков)`);
        console.log(`Bye player: 1 игрок получает проход`);
        
        // Calculate when bye player joins
        let winnersCount = firstRoundMatches;
        let byeRound = -1;
        
        for (let round = 2; round <= totalRounds; round++) {
            if ((winnersCount + 1) % 2 === 0) {
                byeRound = round;
                console.log(`Bye player присоединяется в раунде ${round}`);
                break;
            }
            winnersCount = Math.ceil(winnersCount / 2);
        }
        
        // Show subsequent rounds
        let currentWinners = firstRoundMatches;
        for (let round = 2; round <= totalRounds; round++) {
            if (round === byeRound) {
                currentWinners += 1;
                console.log(`Раунд ${round}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков, включая bye)`);
            } else {
                console.log(`Раунд ${round}: ${Math.ceil(currentWinners / 2)} матчей (${currentWinners} игроков)`);
            }
            currentWinners = Math.ceil(currentWinners / 2);
        }
        
        return { type: 'odd', totalRounds, byePlayer: true, byeRound };
    }
}

function analyzeAdvancement(playerCount) {
    console.log(`\n--- АНАЛИЗ ПРОДВИЖЕНИЯ ИГРОКОВ ---`);
    
    if (playerCount % 2 === 0) {
        // Even players
        let players = playerCount;
        let round = 1;
        
        while (players > 1) {
            const matches = players / 2;
            const winners = matches;
            console.log(`Раунд ${round}: ${players} игроков → ${matches} матчей → ${winners} победителей`);
            players = winners;
            round++;
        }
    } else {
        // Odd players
        let players = playerCount - 1; // Exclude bye player initially
        let round = 1;
        let byePlayerJoined = false;
        
        while (players > 0) {
            const matches = Math.floor(players / 2);
            let winners = matches;
            
            // Check if bye player should join this round
            if (!byePlayerJoined && (winners + 1) % 2 === 0) {
                winners += 1; // Add bye player
                byePlayerJoined = true;
                console.log(`Раунд ${round}: ${players} игроков → ${matches} матчей → ${winners} победителей (включая bye)`);
            } else {
                console.log(`Раунд ${round}: ${players} игроков → ${matches} матчей → ${winners} победителей`);
            }
            
            // Handle odd number of winners
            if (winners > 1 && winners % 2 === 1) {
                console.log(`  ⚠️ Нечетное количество победителей (${winners}) - один получит проход в следующем раунде`);
            }
            
            players = winners;
            round++;
            
            if (players <= 1) break;
        }
    }
}

// Test for 7, 9, 10 players
[7, 9, 10].forEach(playerCount => {
    calculateTournamentBracket(playerCount);
    analyzeAdvancement(playerCount);
    console.log("\n" + "=".repeat(50));
});
